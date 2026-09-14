import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { EndpointProxyService } from 'src/integration/endpoint-proxy.service';
import type { CambiarAccesoUsuarioDto } from './dto/cambiar-acceso-usuario.dto';

/** Roles que Next exige con `idUsuario` en el body (Shift inyecta el del JWT). */
const ROLES_CON_ID_USUARIO_DESDE_TOKEN = new Set([1, 3, 4, 5]);

export interface CambiarAccesoJwtContext {
  userId: number;
  rol: number;
}

@Injectable()
export class AuthUsuarioPasswordService {
  private readonly logger = new Logger(AuthUsuarioPasswordService.name);

  constructor(private readonly endpointProxy: EndpointProxyService) {}

  /**
   * Arma el body hacia Next `POST /usuarios/cambiar/accesso`.
   * Roles 1, 3, 4 y 5: siempre envían `idUsuario` del access token.
   * Otros roles: solo contraseña (Next usa el usuario del token).
   */
  buildCambiarAccesoBody(
    dto: CambiarAccesoUsuarioDto,
    jwt: CambiarAccesoJwtContext,
  ): Record<string, string | number> {
    const body: Record<string, string | number> = {
      passwordNueva: dto.passwordNueva,
      passwordConfirmacion: dto.passwordConfirmacion,
    };

    if (ROLES_CON_ID_USUARIO_DESDE_TOKEN.has(jwt.rol)) {
      body.idUsuario = jwt.userId;
    }

    return body;
  }

  async cambiarAcceso(
    dto: CambiarAccesoUsuarioDto,
    req: Request,
    jwt: CambiarAccesoJwtContext,
  ): Promise<{ status: number; data: unknown }> {
    const body = this.buildCambiarAccesoBody(dto, jwt);

    this.logger.log(
      `Proxy → POST usuarios/cambiar/accesso userId=${jwt.userId} rol=${jwt.rol} ` +
        `idUsuarioEnBody=${body.idUsuario ?? 'omitido'}`,
    );

    const r = await this.endpointProxy.forwardPost(
      'usuarios/cambiar/accesso',
      body,
      req,
    );

    this.logger.log(`Proxy ← POST usuarios/cambiar/accesso status=${r.status}`);

    return r;
  }
}
