import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/guard/jwt-auth.guard';
import { RolesGuard } from 'src/guard/roles.guard';
import { EndpointProxyService } from 'src/integration/endpoint-proxy.service';
import { AuthUsuarioPasswordService } from './auth-usuario-password.service';
import { CambiarAccesoUsuarioDto } from './dto/cambiar-acceso-usuario.dto';
import { UpdateMiPinDto } from './dto/update-mi-pin.dto';
import { UpdateUsuarioContrasenaDto } from './dto/update-usuario-contrasena.dto';

const THROTTLE_CAMBIAR_ACCESO_LIMIT = Number(
  process.env.THROTTLE_CAMBIAR_ACCESO_LIMIT ?? 5,
);
const THROTTLE_CAMBIAR_ACCESO_TTL_MS = Number(
  process.env.THROTTLE_CAMBIAR_ACCESO_TTL_MS ?? 60000,
);

/**
 * Perfil / contraseña / NIP bajo `/api/login/*`.
 * Solo tag Usuarios (no se duplica en Autenticación).
 */
@ApiTags('Usuarios')
@Controller('login')
export class AuthLoginPerfilController {
  private readonly logger = new Logger(AuthLoginPerfilController.name);

  constructor(
    private readonly endpointProxy: EndpointProxyService,
    private readonly authUsuarioPassword: AuthUsuarioPasswordService,
  ) {}

  private jwtUserId(req: Request): number | undefined {
    const u = (req as Request & { user?: { userId?: number } }).user;
    return u?.userId;
  }

  @Post('cambiar/accesso')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer-token')
  @Throttle({
    default: {
      limit: THROTTLE_CAMBIAR_ACCESO_LIMIT,
      ttl: THROTTLE_CAMBIAR_ACCESO_TTL_MS,
    },
  })
  @ApiOperation({
    summary: 'Cambiar contraseña (access o password_reset del correo)',
    description:
      'Proxy BFF hacia Next `POST {ENDPOINT_URL}/api/login/cambiar/accesso`.\n\n' +
      '**Bearer:** JWT de login (`type: access`) o del correo (`type: password_reset`).\n\n' +
      '**Body:** `passwordNueva` + `passwordConfirmacion` (sin `passwordActual`, sin `idUsuario`).\n\n' +
      'Flujo recuperación: token de `#/nueva-contrasena?token=` como Bearer.\n\n' +
      'Tras éxito Next revoca refresh; volver a login. Respuesta: texto plano.',
  })
  @ApiBody({ type: CambiarAccesoUsuarioDto })
  @ApiOkResponse({
    description: 'Contraseña actualizada (texto plano)',
    schema: {
      type: 'string',
      example:
        'La contraseña del usuario Juan ha sido actualizada exitosamente.',
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'Token inválido, expirado o sin type access/password_reset (Next: Token de acceso inválido)',
  })
  @ApiBadRequestResponse({
    description:
      'Validación de contraseña, confirmación distinta, o nueva igual a la anterior',
  })
  @ApiInternalServerErrorResponse({
    description: 'Error al contactar Next',
  })
  async cambiarAccesoSinPasswordActual(
    @Body() dto: CambiarAccesoUsuarioDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.authUsuarioPassword.cambiarAcceso(dto, req);
    res.status(r.status);
    if (typeof r.data === 'string') {
      res.type('text/plain; charset=utf-8');
    }
    return r.data;
  }

  @Patch('cambiar/accesso')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles()
  @ApiOperation({
    summary: 'Cambiar mi contraseña (con contraseña actual)',
    description:
      'Proxy BFF hacia Next `PATCH …/api/usuarios/actualizar/contrasena`. ' +
      'Requiere JWT access de sesión. Body con `passwordActual`. ' +
      'Tras 200, Next revoca tokens: volver a login.',
  })
  @ApiBody({ type: UpdateUsuarioContrasenaDto })
  @ApiOkResponse({
    description: 'Contraseña actualizada',
    schema: {
      example: {
        status: 'success',
        message: 'La contraseña ha sido actualizada correctamente.',
        data: { id: 123, nombre: 'Osmar Martinez' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Sin token, token inválido o expirado',
  })
  @ApiNotFoundResponse({
    description: 'Usuario del token no existe en Next',
  })
  @ApiBadRequestResponse({
    description:
      'Contraseña actual incorrecta, confirmación distinta o validación DTO',
  })
  @ApiForbiddenResponse({ description: 'Usuario sin rol asignado' })
  @ApiInternalServerErrorResponse({
    description: 'Error al actualizar la contraseña o fallo de conexión con Next',
  })
  async cambiarAccessoConPasswordActual(
    @Body() dto: UpdateUsuarioContrasenaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(
      `Proxy → PATCH usuarios/actualizar/contrasena userId=${this.jwtUserId(req) ?? 'n/a'}`,
    );
    const r = await this.endpointProxy.forwardPatch(
      'usuarios/actualizar/contrasena',
      {
        passwordActual: dto.passwordActual,
        passwordNueva: dto.passwordNueva,
        passwordNuevaConfirmacion: dto.passwordNuevaConfirmacion,
      },
      req,
    );
    this.logger.log(
      `Proxy ← PATCH usuarios/actualizar/contrasena status=${r.status}`,
    );
    res.status(r.status);
    return r.data;
  }

  @Patch('mi-nip')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles()
  @ApiOperation({
    summary: 'Definir o cambiar mi NIP/PIN (operador)',
    description:
      'Proxy BFF hacia Next `PATCH …/api/usuarios/mi-nip`. El `userId` sale del JWT. ' +
      'El body usa el campo `pinHash` con el PIN en claro (6 u 8 dígitos); Next lo hashea con bcrypt. ' +
      'No revoca la sesión actual. ' +
      'Login operador: `POST /api/login/operador/accesso/nip` con userName + codigo.',
  })
  @ApiBody({ type: UpdateMiPinDto })
  @ApiOkResponse({
    description: 'NIP actualizado',
    schema: {
      example: {
        status: 'success',
        message: 'El NIP ha sido actualizado correctamente.',
        data: { id: 3, nombre: 'Osmar Martinez' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Sin token o token inválido/expirado',
  })
  @ApiNotFoundResponse({
    description: 'Usuario del token no existe o estatus distinto de activo en Next',
  })
  @ApiBadRequestResponse({
    description: 'PIN inválido (longitud, dígitos, secuencia o todos iguales)',
  })
  @ApiForbiddenResponse({ description: 'Usuario sin rol asignado' })
  @ApiInternalServerErrorResponse({
    description: 'Error al actualizar el NIP o fallo de conexión con Next',
  })
  async actualizarMiNip(
    @Body() dto: UpdateMiPinDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(
      `Proxy → PATCH usuarios/mi-nip userId=${this.jwtUserId(req) ?? 'n/a'} (PIN omitido en log)`,
    );
    const r = await this.endpointProxy.forwardPatch(
      'usuarios/mi-nip',
      { pinHash: dto.pinHash },
      req,
    );
    this.logger.log(`Proxy ← PATCH usuarios/mi-nip status=${r.status}`);
    res.status(r.status);
    return r.data;
  }
}
