import {
  Body,
  Controller,
  Get,
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
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { EndpointProxyService } from 'src/integration/endpoint-proxy.service';
import { LoginAuthDto } from './dto/login-auth.dto';
import { LoginAuthPinDto } from './dto/login-pin.dto';
import { LoginAuthConfirmacionDto } from './dto/login-confirmacion.dto';
import { LoginRefreshTokenDto } from './dto/login-refresh-token.dto';
import { LoginMeResponseDto } from './dto/login-me.response.dto';
import { CodigoPasajeroAutenticacion } from './dto/login-autenticacion.dto';
import { JwtAuthGuard } from 'src/guard/jwt-auth.guard';
import { AuthLoginShadowService } from './auth-login-shadow.service';

const THROTTLE_LOGIN_LIMIT = Number(process.env.THROTTLE_LOGIN_LIMIT ?? 5);
const THROTTLE_LOGIN_TTL_MS = Number(process.env.THROTTLE_LOGIN_TTL_MS ?? 60000);
const THROTTLE_PIN_LIMIT = Number(process.env.THROTTLE_PIN_LIMIT ?? 5);
const THROTTLE_PIN_TTL_MS = Number(process.env.THROTTLE_PIN_TTL_MS ?? 60000);
const THROTTLE_VERIFY_LIMIT = Number(process.env.THROTTLE_VERIFY_LIMIT ?? 3);
const THROTTLE_VERIFY_TTL_MS = Number(process.env.THROTTLE_VERIFY_TTL_MS ?? 60000);
const THROTTLE_RECUPERACION_LIMIT = Number(
  process.env.THROTTLE_RECUPERACION_LIMIT ?? 2,
);
const THROTTLE_RECUPERACION_TTL_MS = Number(
  process.env.THROTTLE_RECUPERACION_TTL_MS ?? 60000,
);
const THROTTLE_RECUPERACION_CONFIRMACION_LIMIT = Number(
  process.env.THROTTLE_RECUPERACION_CONFIRMACION_LIMIT ?? 5,
);
const THROTTLE_RECUPERACION_CONFIRMACION_TTL_MS = Number(
  process.env.THROTTLE_RECUPERACION_CONFIRMACION_TTL_MS ?? 60000,
);
const THROTTLE_REFRESH_LIMIT = Number(process.env.THROTTLE_REFRESH_LIMIT ?? 5);
const THROTTLE_REFRESH_TTL_MS = Number(process.env.THROTTLE_REFRESH_TTL_MS ?? 60000);
const THROTTLE_LOGOUT_LIMIT = Number(process.env.THROTTLE_LOGOUT_LIMIT ?? 5);
const THROTTLE_LOGOUT_TTL_MS = Number(process.env.THROTTLE_LOGOUT_TTL_MS ?? 60000);

@ApiTags('Autenticación')
@Controller('login')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly endpointProxy: EndpointProxyService,
    private readonly authLoginShadow: AuthLoginShadowService,
  ) { }

  private jwtUserId(req: Request): number | undefined {
    const u = (req as Request & { user?: { userId?: number } }).user;
    return u?.userId;
  }

  @Post('usuario/solicitud/recuperacion')
  @Throttle({
    default: {
      limit: THROTTLE_RECUPERACION_LIMIT,
      ttl: THROTTLE_RECUPERACION_TTL_MS,
    },
  })
  async solicitudRecuperacion(
    @Body() dto: LoginAuthConfirmacionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(
      `Proxy → POST login/usuario/solicitud/recuperacion userName=${dto.userName}`,
    );
    const r = await this.endpointProxy.forwardPost(
      'login/usuario/solicitud/recuperacion',
      dto,
      req,
    );
    this.logger.log(
      `Proxy ← POST login/usuario/solicitud/recuperacion status=${r.status}`,
    );
    res.status(r.status);
    return r.data;
  }

  @Post('recuperar/confirmacion')
  @Throttle({
    default: {
      limit: THROTTLE_RECUPERACION_CONFIRMACION_LIMIT,
      ttl: THROTTLE_RECUPERACION_CONFIRMACION_TTL_MS,
    },
  })
  async recuperarConfirmacion(
    @Body() dto: LoginAuthConfirmacionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(
      `Proxy → POST login/recuperar/confirmacion userName=${dto.userName}`,
    );
    const r = await this.endpointProxy.forwardPost(
      'login/recuperar/confirmacion',
      dto,
      req,
    );
    this.logger.log(
      `Proxy ← POST login/recuperar/confirmacion status=${r.status}`,
    );
    res.status(r.status);
    return r.data;
  }

  @Post('operador/accesso/nip')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: THROTTLE_PIN_LIMIT, ttl: THROTTLE_PIN_TTL_MS },
  })
  async loginPin(
    @Body() dto: LoginAuthPinDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(
      `Proxy → POST login/operador/accesso/nip userName=${dto.userName} Nombres=SIT`,
    );
    const r = await this.endpointProxy.forwardPost(
      'login/operador/accesso/nip',
      dto,
      req,
      { Nombres: 'SIT' },
    );
    this.logger.log(
      `Proxy ← POST login/operador/accesso/nip status=${r.status}`,
    );
    await this.authLoginShadow.applyShadowSyncFromLoginResponse(r.data, r.status);
    res.status(r.status);
    return r.data;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: THROTTLE_LOGIN_LIMIT, ttl: THROTTLE_LOGIN_TTL_MS },
  })
  async login(
    @Body() dto: LoginAuthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(
      `Proxy → POST login userName=${dto.userName} Nombres=SIT`,
    );
    const r = await this.endpointProxy.forwardPost('login', dto, req, {
      Nombres: 'SIT',
    });
    this.logger.log(`Proxy ← POST login status=${r.status}`);
    await this.authLoginShadow.applyShadowSyncFromLoginResponse(r.data, r.status, {
      warnWhenMissingClaims: true,
    });
    res.status(r.status);
    return r.data;
  }

  @Get('me')
  @ApiBearerAuth('bearer-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Perfil del usuario autenticado',
    description:
      'Proxy BFF hacia Next `GET {ENDPOINT_URL}/api/login/me`. ' +
      'El `userId` se toma del JWT; no se envía en URL ni body. ' +
      'Incluye `telefono` (Usuarios.Telefono en Next; `""` si es null).',
  })
  @ApiOkResponse({
    description: 'Perfil del usuario activo',
    type: LoginMeResponseDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Token ausente, inválido o expirado; usuario no encontrado o inactivo (estatus ≠ 1)',
  })
  async me(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Proxy → GET login/me userId=${this.jwtUserId(req) ?? 'n/a'}`);
    const r = await this.endpointProxy.forwardGet('login/me', req);
    this.logger.log(`Proxy ← GET login/me status=${r.status}`);
    res.status(r.status);
    return r.data;
  }

  @Patch('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: THROTTLE_VERIFY_LIMIT, ttl: THROTTLE_VERIFY_TTL_MS },
  })
  async verify(
    @Body() dto: CodigoPasajeroAutenticacion,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log('Proxy → PATCH login/verify (código no registrado en log)');
    const r = await this.endpointProxy.forwardPatch('login/verify', dto, req);
    this.logger.log(`Proxy ← PATCH login/verify status=${r.status}`);
    res.status(r.status);
    return r.data;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: THROTTLE_REFRESH_LIMIT, ttl: THROTTLE_REFRESH_TTL_MS },
  })
  async refreshToken(
    @Body() dto: LoginRefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log('Proxy → POST login/refresh (refreshToken omitido en log)');
    const r = await this.endpointProxy.forwardPost(
      'login/refresh',
      dto,
      req,
    );
    this.logger.log(`Proxy ← POST login/refresh status=${r.status}`);
    await this.authLoginShadow.applyShadowSyncFromLoginResponse(r.data, r.status);
    res.status(r.status);
    return r.data;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer-token')
  @UseGuards(JwtAuthGuard)
  @Throttle({
    default: { limit: THROTTLE_LOGOUT_LIMIT, ttl: THROTTLE_LOGOUT_TTL_MS },
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Proxy → POST login/logout userId=${this.jwtUserId(req) ?? 'n/a'}`);
    const r = await this.endpointProxy.forwardPost('login/logout', {}, req);
    this.logger.log(`Proxy ← POST login/logout status=${r.status}`);
    res.status(r.status);
    return r.data;
  }
}
