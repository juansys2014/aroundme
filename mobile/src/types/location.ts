export type LocationSnapshot = {
  lat: number;
  lng: number;
  /** Ciudad aproximada si el geocodificador devolvió datos; si no, coordenadas */
  label: string;
};
