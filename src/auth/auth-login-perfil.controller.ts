import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Patch,
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
import type { Request, Response } from 'express';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/guard/jwt-auth.guard';
import { RolesGuard } from 'src/guard/roles.guard';
import { EndpointProxyService } from 'src/integration/endpoint-proxy.service';
import { UpdateUsuarioContrasenaDto } from './dto/update-usuario-contrasena.dto';

/**
 * Perfil / contraseña bajo ruta `/api/login/*`, documentado solo en tag Usuarios
 * (no aparece duplicado en Autenticación).
 */
@ApiTags('Usuarios')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles()
@Controller('login')
export class AuthLoginPerfilController {
  private readonly logger = new Logger(AuthLoginPerfilController.name);

  constructor(private readonly endpointProxy: EndpointProxyService) {}

  private jwtUserId(req: Request): number | undefined {
    const u = (req as Request & { user?: { userId?: number } }).user;
    return u?.userId;
  }

  @Patch('cambiar/accesso')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cambiar mi contraseña',
    description:
      'Proxy BFF hacia Next `PATCH …/api/usuarios/actualizar/contrasena`. ' +
      'El `userId` se toma del JWT; no enviar id en URL ni body. ' +
      'Tras un 200 exitoso, Next revoca el access y refresh token actuales: el cliente debe volver a hacer login.',
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
  async cambiarAccesso(
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
}
