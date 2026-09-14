import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehiculos } from 'src/entities/Vehiculos';
import { Turnos } from 'src/entities/Turnos';
import { VehiculosController } from './vehiculos.controller';
import { VehiculosService } from './vehiculos.service';
import { EndpointProxyModule } from 'src/integration/endpoint-proxy.module';
import { TenantFilterModule } from 'src/common/tenant-filter/tenant-filter.module';
import { TurnosModule } from 'src/turnos/turnos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vehiculos, Turnos]),
    EndpointProxyModule,
    TenantFilterModule,
    forwardRef(() => TurnosModule),
  ],
  controllers: [VehiculosController],
  providers: [VehiculosService],
  exports: [VehiculosService],
})
export class VehiculosModule {}
