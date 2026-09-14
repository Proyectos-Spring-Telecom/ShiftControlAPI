import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthNextFaceProxyController } from './auth-next-face-proxy.controller';
import { AuthLoginPerfilController } from './auth-login-perfil.controller';
import { AuthLoginShadowService } from './auth-login-shadow.service';
import { AuthUsuarioPasswordService } from './auth-usuario-password.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { EndpointProxyModule } from 'src/integration/endpoint-proxy.module';
import { BitacoraModule } from 'src/bitacora/bitacora.module';
import { Usuarios } from 'src/entities/Usuarios';
import { Clientes } from 'src/entities/Clientes';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuarios, Clientes]),
    ConfigModule,
    EndpointProxyModule,
    BitacoraModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: Number(config.get<string>('JWT_EXPIRES_IN')),
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
    AuthLoginPerfilController,
    AuthNextFaceProxyController,
  ],
  providers: [JwtStrategy, AuthLoginShadowService, AuthUsuarioPasswordService],
  exports: [JwtModule],
})
export class AuthModule {}
