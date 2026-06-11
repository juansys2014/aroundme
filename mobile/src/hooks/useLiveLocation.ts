import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LocationSnapshot } from "../types/location";

type UseLiveLocationOptions = {
  enabled: boolean;
};

export function useLiveLocation({ enabled }: UseLiveLocationOptions) {
  const [location, setLocation] = useState<LocationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastGeocodeAt = useRef(0);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  const applyCoords = useCallback(async (lat: number, lng: number) => {
    setLocation((prev) => ({
      lat,
      lng,
      label: prev?.label ?? "Zona detectada",
    }));
    setLoading(false);
    setError(null);

    const now = Date.now();
    if (now - lastGeocodeAt.current < 45000) return;
    lastGeocodeAt.current = now;

    try {
      const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const p = places[0];
      if (p) {
        const parts = [p.city, p.region, p.country].filter(Boolean);
        if (parts.length > 0) {
          setLocation({ lat, lng, label: parts.join(", ") });
        }
      }
    } catch {
      // solo coordenadas
    }
  }, []);

  const startWatch = useCallback(async () => {
    watchRef.current?.remove();
    watchRef.current = null;
    setLoading(true);
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setError("Se necesita permiso de ubicación para continuar.");
        setLoading(false);
        return;
      }

      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 25,
          timeInterval: 8000,
        },
        (pos) => {
          void applyCoords(pos.coords.latitude, pos.coords.longitude);
        }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo obtener la ubicación.";
      setError(msg);
      setLoading(false);
    }
  }, [applyCoords]);

  useEffect(() => {
    if (!enabled) {
      watchRef.current?.remove();
      watchRef.current = null;
      return;
    }

    void startWatch();

    return () => {
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, [enabled, startWatch]);

  const retry = useCallback(() => {
    void startWatch();
  }, [startWatch]);

  return { location, loading, error, retry };
}
