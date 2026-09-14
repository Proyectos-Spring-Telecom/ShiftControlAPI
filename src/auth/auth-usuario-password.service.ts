import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { EndpointProxyService } from 'src/integration/endpoint-proxy.service';
import type { CambiarAccesoUsuarioDto } from './dto/cambiar-acceso-usuario.dto';

/**
 * Proxy hacia Next `POST /api/login/cambiar/accesso`.
 * Acepta Bearer de login (`type: access`) o del correo (`type: password_reset`).
 * El usuario sale del JWT en Next; el body solo lleva contraseñas.
 */
@Injectable()
export class AuthUsuarioPasswordService {
  private readonly logger = new Logger(AuthUsuarioPasswordService.name);

  constructor(private readonly endpointProxy: EndpointProxyService) {}

  buildCambiarAccesoBody(
    dto: CambiarAccesoUsuarioDto,
  ): Record<string, string> {
    return {
      passwordNueva: dto.passwordNueva,
      passwordConfirmacion: dto.passwordConfirmacion,
    };
  }

  async cambiarAcceso(
    dto: CambiarAccesoUsuarioDto,
    req: Request,
  ): Promise<{ status: number; data: unknown }> {
    const authorization =
      typeof req.headers.authorization === 'string'
        ? req.headers.authorization.trim()
        : '';
    if (!authorization.toLowerCase().startsWith('bearer ')) {
      throw new BadRequestException(
        'Debe enviar Authorization: Bearer <token> (access o password_reset del correo)',
      );
    }

    const body = this.buildCambiarAccesoBody(dto);

    this.logger.log(
      'Proxy → POST login/cambiar/accesso (Bearer omitido en log; body solo passwords)',
    );

    const r = await this.endpointProxy.forwardPost(
      'login/cambiar/accesso',
      body,
      req,
    );

    this.logger.log(`Proxy ← POST login/cambiar/accesso status=${r.status}`);

    return r;
  }
}
