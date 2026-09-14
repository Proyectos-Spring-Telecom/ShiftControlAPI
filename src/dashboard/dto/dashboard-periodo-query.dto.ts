import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, Matches } from 'class-validator';

const FECHA_SOLO_DIA = /^\d{4}-\d{2}-\d{2}$/;

export class DashboardPeriodoQueryDto {
  @IsNotEmpty({ message: 'fechaDesde es requerida' })
  @Matches(FECHA_SOLO_DIA, {
    message: 'fechaDesde debe tener formato YYYY-MM-DD',
  })
  @ApiProperty({
    description: 'Inicio del periodo (YYYY-MM-DD, inclusive)',
    example: '2026-06-01',
  })
  fechaDesde: string;

  @IsNotEmpty({ message: 'fechaHasta es requerida' })
  @Matches(FECHA_SOLO_DIA, {
    message: 'fechaHasta debe tener formato YYYY-MM-DD',
  })
  @ApiProperty({
    description: 'Fin del periodo (YYYY-MM-DD, inclusive)',
    example: '2026-06-30',
  })
  fechaHasta: string;
}
