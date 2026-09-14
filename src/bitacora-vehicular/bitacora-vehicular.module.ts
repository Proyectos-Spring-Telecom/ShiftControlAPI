import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitacoraVehiculo } from 'src/entities/BitacoraVehiculo';
import { InspeccionVehiculoEx } from 'src/entities/InspeccionVehiculoEx';
import { EndpointProxyModule } from 'src/integration/endpoint-proxy.module';
import { VehiculosModule } from 'src/vehiculos/vehiculos.module';
import { UbicacionModule } from 'src/ubicacion/ubicacion.module';
import { BitacoraVehicularController } from './bitacora-vehicular.controller';
import { BitacoraVehicularService } from './bitacora-vehicular.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BitacoraVehiculo, InspeccionVehiculoEx]),
    EndpointProxyModule,
    forwardRef(() => VehiculosModule),
    UbicacionModule,
  ],
  controllers: [BitacoraVehicularController],
  providers: [BitacoraVehicularService],
  exports: [BitacoraVehicularService],
})
export class BitacoraVehicularModule { }
