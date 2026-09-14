import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
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
import { AuthUsuarioPasswordService } from './auth-usuario-password.service';
import { CambiarAccesoUsuarioDto } from './dto/cambiar-acceso-usuario.dto';

const THROTTLE_CAMBIAR_ACCESO_LIMIT = Number(
  process.env.THROTTLE_CAMBIAR_ACCESO_LIMIT ?? 5,
);
const THROTTLE_CAMBIAR_ACCESO_TTL_MS = Number(
  process.env.THROTTLE_CAMBIAR_ACCESO_TTL_MS ?? 60000,
);

@ApiTags('Usuarios')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles()
@Controller('usuarios')
export class AuthUsuariosController {
  constructor(
    private readonly authUsuarioPassword: AuthUsuarioPasswordService,
  ) {}

  private jwtContext(req: Request): { userId: number; rol?: number } {
    const user = (req as Request & {
      user?: { userId?: number | string; rol?: number | string };
    }).user;
    const userId = Number(user?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new UnauthorizedException(
        'JWT de ShiftControl inválido o ausente (falta id de usuario)',
      );
    }

    if (user?.rol === undefined || user?.rol === null || user?.rol === '') {
      return { userId };
    }
    const rol = Number(user.rol);
    if (!Number.isFinite(rol)) {
      return { userId };
    }
    return { userId, rol };
  }

  @Post('cambiar/accesso')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: THROTTLE_CAMBIAR_ACCESO_LIMIT,
      ttl: THROTTLE_CAMBIAR_ACCESO_TTL_MS,
    },
  })
  @ApiOperation({
    summary: 'Cambiar contraseña sin contraseña actual (proxy Next)',
    description:
      'Proxy BFF hacia Next `POST {ENDPOINT_URL}/api/usuarios/cambiar/accesso`.\n\n' +
      '**Sin** `passwordActual` (distinto de `PATCH /api/login/cambiar/accesso` → `actualizar/contrasena`).\n\n' +
      '**Roles 1, 3, 4 y 5:** Shift envía `idUsuario` del JWT en el body.\n\n' +
      '**Otros roles:** no se envía `idUsuario`; Next cambia la contraseña del usuario del token.\n\n' +
      'Tras éxito, Next revoca refresh tokens del usuario afectado. Si el usuario cambió su propia contraseña, ' +
      'el cliente debe cerrar sesión y volver a login.\n\n' +
      'Respuesta exitosa: **texto plano** (no JSON).',
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
    description: 'Sin token, token inválido o expirado',
  })
  @ApiBadRequestResponse({
    description:
      'Validación de contraseña, confirmación distinta, usuario no encontrado, o idUsuario obligatorio en Next',
  })
  @ApiForbiddenResponse({ description: 'Usuario sin rol asignado' })
  @ApiInternalServerErrorResponse({
    description: 'Error al contactar Next',
  })
  async cambiarAcceso(
    @Body() dto: CambiarAccesoUsuarioDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const jwt = this.jwtContext(req);
    const r = await this.authUsuarioPassword.cambiarAcceso(dto, req, jwt);

    res.status(r.status);
    if (typeof r.data === 'string') {
      res.type('text/plain; charset=utf-8');
    }
    return r.data;
  }
}
