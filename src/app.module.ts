import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BitacoraModule } from './bitacora/bitacora.module';
import { ClientesModule } from './clientes/clientes.module';
import { ModulosModule } from './modulos/modulos.module';
import { S3Module } from './s3/s3.module';
import { CatEstatusTurnoModule } from './cat-estatus-turno/cat-estatus-turno.module';
import { CatGradoSeveridadModule } from './cat-grado-severidad/cat-grado-severidad.module';
import { CatTipoDanoModule } from './cat-tipo-dano/cat-tipo-dano.module';
import { CatVistaVehiculoModule } from './cat-vista-vehiculo/cat-vista-vehiculo.module';
import { VehiculosModule } from './vehiculos/vehiculos.module';
import { TurnosModule } from './turnos/turnos.module';
import { ReportesModule } from './reportes/reportes.module';
import { EmbedModule } from './embed/embed.module';
import { PlacasModule } from './placas/placas.module';
import { UbicacionModule } from './ubicacion/ubicacion.module';
import { BitacoraVehicularModule } from './bitacora-vehicular/bitacora-vehicular.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { DashboardModule } from './dashboard/dashboard.module';
import Joi from 'joi';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().default(3306),
        DB_USER: Joi.string().required(),
        DB_PASSWORD: Joi.string().allow(''), // Puede estar vacío si no hay pass
        DB_DATABASE: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRES_IN: Joi.string().required(),
        JWT_CONFIRMACION: Joi.string().required(),
        ENDPOINT_URL: Joi.string().uri().required(),
        AWS_REGION: Joi.string().required(),
        AWS_ACCESS_KEY_ID: Joi.string().required(),
        AWS_SECRET_ACCESS_KEY: Joi.string().required(),
        AWS_S3_BUCKET: Joi.string().required(),
        UPLOAD_MAX_SIZE: Joi.string().required(),
        TURNOS_STORAGE_PATH: Joi.string().required(),
        TURNOS_PUBLIC_URL: Joi.string().uri().required(),
        PDF_IMAGE_MAX_WIDTH: Joi.number().default(800),
        PDF_IMAGE_QUALITY: Joi.number().min(1).max(100).default(75),
        HOST: Joi.string().required(),
        SMTP: Joi.number().required(),
        E_MAIL: Joi.string().email().required(),
        MAIL_PASSWORD: Joi.string().required(),
        THROTTLE_DEFAULT_LIMIT: Joi.number().default(100),
        THROTTLE_DEFAULT_TTL_MS: Joi.number().default(60000),
        THROTTLE_LOGIN_LIMIT: Joi.number().default(5),
        THROTTLE_LOGIN_TTL_MS: Joi.number().default(60000),
        THROTTLE_PIN_LIMIT: Joi.number().default(5),
        THROTTLE_PIN_TTL_MS: Joi.number().default(60000),
        THROTTLE_VERIFY_LIMIT: Joi.number().default(3),
        THROTTLE_VERIFY_TTL_MS: Joi.number().default(60000),
        THROTTLE_RECUPERACION_LIMIT: Joi.number().default(2),
        THROTTLE_RECUPERACION_TTL_MS: Joi.number().default(60000),
        THROTTLE_RECUPERACION_CONFIRMACION_LIMIT: Joi.number().default(5),
        THROTTLE_RECUPERACION_CONFIRMACION_TTL_MS: Joi.number().default(60000),
        THROTTLE_REFRESH_LIMIT: Joi.number().default(5),
        THROTTLE_REFRESH_TTL_MS: Joi.number().default(60000),
        THROTTLE_LOGOUT_LIMIT: Joi.number().default(5),
        THROTTLE_LOGOUT_TTL_MS: Joi.number().default(60000),
        BEHAVIORIQ_BASE_URL: Joi.string().uri().optional(),
        BEHAVIORIQ_USER_NAME: Joi.string().optional().allow(''),
        BEHAVIORIQ_PASSWORD: Joi.string().optional().allow(''),
        NOMINATIM_BASE_URL: Joi.string().uri().optional(),
        WEBHOOK_SECRET: Joi.string().allow('').default(''),
      }),
    }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('THROTTLE_DEFAULT_TTL_MS', 60000),
            limit: config.get<number>('THROTTLE_DEFAULT_LIMIT', 100),
          },
        ],
      }),
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE'),
        autoLoadEntities: false,
        entities: [__dirname + '/entities/*{.ts,.js}'],
        synchronize: false, //Nunca poner en true
        dateStrings: false,
        timezone: '-06:00',
        bigNumberStrings: false,
        logging: true,
        extra: {
          // Evita que bigint se devuelvan como string
          decimalNumbers: true,
        },
      }),
    }),

    AuthModule,

    BitacoraModule,

    ClientesModule,

    S3Module,

    ModulosModule,

    CatEstatusTurnoModule,

    CatGradoSeveridadModule,

    CatTipoDanoModule,

    CatVistaVehiculoModule,

    VehiculosModule,

    TurnosModule,

    ReportesModule,

    EmbedModule,

    PlacasModule,

    UbicacionModule,

    BitacoraVehicularModule,

    WebhooksModule,

    DashboardModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
