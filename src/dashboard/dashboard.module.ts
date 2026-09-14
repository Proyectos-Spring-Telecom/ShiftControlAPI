import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Turnos } from 'src/entities/Turnos';
import { Vehiculos } from 'src/entities/Vehiculos';
import { IncidenciaAccidente } from 'src/entities/IncidenciaAccidente';
import { IncidenciaGasolina } from 'src/entities/IncidenciaGasolina';
import { BitacoraVehiculo } from 'src/entities/BitacoraVehiculo';
import { Tablero } from 'src/entities/Tablero';
import { TenantFilterModule } from 'src/common/tenant-filter/tenant-filter.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Turnos,
      Vehiculos,
      IncidenciaAccidente,
      IncidenciaGasolina,
      BitacoraVehiculo,
      Tablero,
    ]),
    TenantFilterModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
