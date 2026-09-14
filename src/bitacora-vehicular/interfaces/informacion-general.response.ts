export interface InformacionGeneralVehiculo {
  titulo: string;
  subtitulo: string;
}

export interface InformacionGeneralOperador {
  nombre: string;
  id: string;
}

export interface EstadoVehiculoItem {
  etiqueta: string;
  valor: string;
}

export type MetricaInicialItem = EstadoVehiculoItem;

export interface InformacionGeneralResponse {
  informacionGeneral: {
    vehiculo: InformacionGeneralVehiculo;
    operador: InformacionGeneralOperador;
    estadoVehiculo: EstadoVehiculoItem[];
    metricasIniciales: MetricaInicialItem[];
    ubicacion: string | null;
    /** URL pública de Turnos.EvidenciaLicencia (turno ligado a la bitácora). */
    evidenciaLicencia: string | null;
  };
}
