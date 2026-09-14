import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpStringResponseFilter } from './utils/http-string-response.filter';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

  // Prefijo global: todas las rutas bajo /api (auth, mesas, clientes, etc.)
  app.setGlobalPrefix('api');

  // Sirve imágenes de turnos desde disco local (TURNOS_STORAGE_PATH → TURNOS_PUBLIC_URL)
  const turnosStoragePath = process.env.TURNOS_STORAGE_PATH?.trim();
  const turnosPublicUrl = process.env.TURNOS_PUBLIC_URL?.trim();
  if (turnosStoragePath && turnosPublicUrl) {
    try {
      const publicPathname = new URL(turnosPublicUrl).pathname.replace(/\/+$/, '') || '/';
      app.useStaticAssets(path.resolve(turnosStoragePath), {
        prefix: publicPathname,
      });
    } catch {
      // Si TURNOS_PUBLIC_URL no es URL válida, no montamos estáticos
    }
  }

  app.useGlobalFilters(new HttpStringResponseFilter());

  app.enableCors({
    origin: '*', // Permitir todas las URLs; puedes poner un array de URLs específicas
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('Shift Control')
    .setDescription('Documentación de la API de Shift Control')
    .setVersion('1.0')
    .addServer('http://localhost:3003', 'Servidor Local')
    .addServer('https://springtelecom.mx/shiftControlAPI', 'Servidor Spring')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'bearer-token',
        description: 'Ingresa el token Bearer',
        in: 'header',
      },
      'bearer-token',
    )
    .addTag('Autenticación', 'Endpoints de autenticación y registro')
    .addTag(
      'Usuarios',
      'Perfil y contraseña del usuario autenticado (proxy Next)',
    )
    .addTag('Bitácora', 'Registro de actividades del sistema')
    .addTag('Clientes', 'Gestión de clientes')
    .addTag('Modulos', 'Gestión de módulos del sistema')
    .addTag('Permisos', 'Gestión de permisos')
    .addTag('S3 - archivos', 'Carga de archivos a S3')
    .addTag('Cat Estatus Turno', 'Catálogo estatus de turno')
    .addTag('Cat Grado Severidad', 'Catálogo grado de severidad')
    .addTag('Cat Tipo Daño', 'Catálogo tipo de daño')
    .addTag('Cat Vista Vehiculo', 'Catálogo vista del vehículo')
    .addTag('Vehiculos', 'Consulta y sombra de vehículos (proxy Next)')
    .addTag('Reportes PDF', 'Reportes PDF e HTML de turnos y vehículos (Puppeteer)')
    .addTag(
      'Embed (BehaviorIQ)',
      'Afiliación de rostro — pasos 1 y 2: validar pose (`POST /embed/validate-pose`) e imagen a embedding 512D (`POST /embed`). Requiere JWT ShiftControl; hacia BehaviorIQ el servidor usa `BEHAVIORIQ_*` (login .env), como OCR placa en turnos. Guía: docs/EMBED_BFF_SHIFTCONTROL.md.',
    )
    .addTag(
      'Rostros (BehaviorIQ)',
      'Afiliación de rostro — paso 3: alta con `embeddings` o `embeddingsList` (`POST /rostros`). JWT ShiftControl + login BehaviorIQ con `BEHAVIORIQ_*` en servidor. Guía: docs/EMBED_BFF_SHIFTCONTROL.md.',
    )
    .addTag(
      'Placa (proxy) (BehaviorIQ)',
      'Afiliación de placa — OCR (`POST /plate/read`). Requiere JWT ShiftControl; hacia BehaviorIQ el servidor usa `BEHAVIORIQ_*` (login .env).',
    )
    .addTag(
      'Placas (BehaviorIQ)',
      'Afiliación de placa — alta (`POST /placas`). Requiere JWT ShiftControl; hacia BehaviorIQ el servidor usa `BEHAVIORIQ_*` (login .env).',
    )
    .addTag(
      'Webhooks',
      'Receptor de eventos desde Next (`POST /webhooks/next`). Autenticación HMAC con `WEBHOOK_SECRET`, sin JWT.',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      defaultModelsExpandDepth: -1,
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3003);
}
bootstrap();
