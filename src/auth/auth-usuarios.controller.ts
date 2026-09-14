import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUsuarioPasswordService } from './auth-usuario-password.service';
import { CambiarAccesoUsuarioDto } from './dto/cambiar-acceso-usuario.dto';

const THROTTLE_CAMBIAR_ACCESO_LIMIT = Number(
  process.env.THROTTLE_CAMBIAR_ACCESO_LIMIT ?? 5,
);
const THROTTLE_CAMBIAR_ACCESO_TTL_MS = Number(
  process.env.THROTTLE_CAMBIAR_ACCESO_TTL_MS ?? 60000,
);

/**
 * Alias legado: misma operación que `POST /api/login/cambiar/accesso`.
 * Preferir la ruta bajo `/login` (recuperación + access).
 */
@ApiTags('Usuarios')
@ApiBearerAuth('bearer-token')
@Controller('usuarios')
export class AuthUsuariosController {
  constructor(
    private readonly authUsuarioPassword: AuthUsuarioPasswordService,
  ) {}

  @Post('cambiar/accesso')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: THROTTLE_CAMBIAR_ACCESO_LIMIT,
      ttl: THROTTLE_CAMBIAR_ACCESO_TTL_MS,
    },
  })
  @ApiOperation({
    summary: 'Cambiar contraseña (alias → Next POST /login/cambiar/accesso)',
    description:
      'Alias de `POST /api/login/cambiar/accesso`. Proxy a Next `POST …/api/login/cambiar/accesso`.\n\n' +
      'Bearer: JWT `access` o `password_reset` (correo). Body: `passwordNueva` + `passwordConfirmacion`.\n\n' +
      '**Preferir** `POST /api/login/cambiar/accesso`. No enviar `idUsuario`. Respuesta texto plano.',
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
    description: 'Token inválido, expirado o sin type access/password_reset (Next)',
  })
  @ApiBadRequestResponse({
    description: 'Validación de contraseña o confirmación distinta',
  })
  @ApiInternalServerErrorResponse({
    description: 'Error al contactar Next',
  })
  async cambiarAcceso(
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
}
