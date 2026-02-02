import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { LatLng as RNLatLng, Marker, Polyline, Region } from 'react-native-maps';

import { boundingRegion, parseGpxXml, type LatLng } from './src/gpx';

type NavMode = 'browse' | 'drive';

function kmh(ms: number) {
  return ms * 3.6;
}

function fmtSpeed(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const v = kmh(ms);
  if (!Number.isFinite(v) || v < 0) return '0';
  return String(Math.round(v));
}

function NavigatorApp() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const [routeName, setRouteName] = useState<string | undefined>();
  const [route, setRoute] = useState<LatLng[]>([]);

  const [mode, setMode] = useState<NavMode>('browse');

  const [locPerm, setLocPerm] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [speedMs, setSpeedMs] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [servicesEnabled, setServicesEnabled] = useState<boolean | null>(null);

  const [loadingGpx, setLoadingGpx] = useState(false);
  const [gpxError, setGpxError] = useState<string | null>(null);

  const region: Region | null = useMemo(() => {
    const r = boundingRegion(route);
    return r;
  }, [route]);

  const polylineCoords: RNLatLng[] = useMemo(() => {
    return route.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  }, [route]);

  const startPoint = route[0];

  async function requestLocationPermission() {
    const enabled = await Location.hasServicesEnabledAsync();
    setServicesEnabled(enabled);
    if (!enabled) {
      setGpsError('Location services are OFF. Enable GPS/location services and try again.');
    }

    const res = await Location.requestForegroundPermissionsAsync();
    setLocPerm(res.status === 'granted' ? 'granted' : 'denied');
    return res.status === 'granted' && enabled;
  }

  async function pickGpx() {
    try {
      setGpxError(null);
      setLoadingGpx(true);

      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/gpx+xml', 'application/xml', 'text/xml', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (picked.canceled) return;
      const asset = picked.assets?.[0];
      if (!asset?.uri) throw new Error('No file URI returned');

      const xml = await FileSystem.readAsStringAsync(asset.uri);

      const parsed = parseGpxXml(xml);
      if (!parsed.points.length) throw new Error('No route points found in GPX');

      setRouteName(parsed.name);
      setRoute(parsed.points);
      setMode('browse');

      // Fit map
      const r = boundingRegion(parsed.points);
      if (r) {
        // wait a tick so map is mounted
        requestAnimationFrame(() => {
          mapRef.current?.animateToRegion(r, 600);
        });
      }
    } catch (e: any) {
      setGpxError(e?.message ?? 'Failed to load GPX');
    } finally {
      setLoadingGpx(false);
    }
  }

  function stopNavigation() {
    setMode('browse');
  }

  async function startNavigation() {
    setGpsError(null);
    const ok = await requestLocationPermission();
    if (!ok) {
      // requestLocationPermission already sets a more specific gpsError if services are off
      if (!gpsError) setGpsError('Location permission denied');
      return;
    }

    setMode('drive');

    // Immediately switch to a "driving" camera feel (tilt + zoom)
    requestAnimationFrame(() => {
      if (location) {
        mapRef.current?.animateCamera(
          {
            center: {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            },
            pitch: 60,
            heading: location.coords.heading ?? 0,
            zoom: 17,
          },
          { duration: 500 }
        );
      } else if (region) {
        mapRef.current?.animateCamera(
          {
            center: { latitude: region.latitude, longitude: region.longitude },
            pitch: 55,
            heading: 0,
            zoom: 15,
          },
          { duration: 500 }
        );
      }
    });
  }

  // GPS tracking loop
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      if (mode !== 'drive') return;

      try {
        const hasPerm = locPerm === 'granted' ? true : await requestLocationPermission();
        if (!hasPerm) return;

        // High accuracy + frequent updates
        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Highest,
            timeInterval: 1000,
            distanceInterval: 1,
            mayShowUserSettingsDialog: true,
          },
          (pos) => {
            setLocation(pos);
            const sp = pos.coords.speed;
            setSpeedMs(sp == null ? null : sp);

            if (mode === 'drive') {
              mapRef.current?.animateCamera(
                {
                  center: {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                  },
                  pitch: 60,
                  heading: pos.coords.heading ?? 0,
                  zoom: 17,
                },
                { duration: 450 }
              );
            }
          }
        );
      } catch (e: any) {
        setGpsError(e?.message ?? 'GPS error');
      }
    })();

    return () => {
      sub?.remove();
      sub = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Initial permission state
  useEffect(() => {
    (async () => {
      const p = await Location.getForegroundPermissionsAsync();
      setLocPerm(p.status === 'granted' ? 'granted' : p.status === 'denied' ? 'denied' : 'unknown');
      const enabled = await Location.hasServicesEnabledAsync();
      setServicesEnabled(enabled);
    })();
  }, []);

  const speedText = fmtSpeed(speedMs);

  return (
    <View style={styles.safe}>
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>GPX Navigator</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {routeName ? routeName : route.length ? 'Loaded GPX route' : 'Load a GPX file to begin'}
          </Text>
        </View>

        <Pressable style={styles.btn} onPress={pickGpx} disabled={loadingGpx}>
          <Text style={styles.btnText}>{loadingGpx ? 'Loading…' : 'Load GPX'}</Text>
        </Pressable>

        {route.length > 0 && mode !== 'drive' ? (
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={startNavigation}>
            <Text style={[styles.btnText, styles.btnPrimaryText]}>Start</Text>
          </Pressable>
        ) : null}

        {mode === 'drive' ? (
          <Pressable style={[styles.btn, styles.btnDanger]} onPress={stopNavigation}>
            <Text style={[styles.btnText, styles.btnDangerText]}>Stop</Text>
          </Pressable>
        ) : null}
      </View>

      {!!gpxError && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>GPX: {gpxError}</Text>
        </View>
      )}
      {!!gpsError && (
        <View style={[styles.banner, { borderColor: '#ff5f5f' }]}>
          <Text style={styles.bannerText}>GPS: {gpsError}</Text>
        </View>
      )}

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={
            region ?? {
              latitude: 51.5072,
              longitude: -0.1276,
              latitudeDelta: 0.2,
              longitudeDelta: 0.2,
            }
          }
          showsUserLocation={mode === 'drive'}
          followsUserLocation={false}
          showsMyLocationButton
          toolbarEnabled
          pitchEnabled
          rotateEnabled
          mapType="standard"
          camera={
            mode === 'drive'
              ? {
                  center: location
                    ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
                    : region
                      ? { latitude: region.latitude, longitude: region.longitude }
                      : { latitude: 51.5072, longitude: -0.1276 },
                  pitch: 55,
                  heading: location?.coords.heading ?? 0,
                  altitude: 900,
                  zoom: 17,
                }
              : undefined
          }
        >
          {route.length > 0 ? (
            <Polyline coordinates={polylineCoords} strokeWidth={5} strokeColor="#7aa2ff" />
          ) : null}

          {startPoint ? (
            <Marker
              coordinate={{ latitude: startPoint.latitude, longitude: startPoint.longitude }}
              title="Start"
              description={routeName}
            />
          ) : null}

          {location ? (
            <Marker
              coordinate={{ latitude: location.coords.latitude, longitude: location.coords.longitude }}
              title="You"
              pinColor="#4bf08b"
            />
          ) : null}
        </MapView>

        {/* Drive HUD */}
        <View style={styles.hud} pointerEvents="none">
          <View style={styles.hudCard}>
            <Text style={styles.hudLabel}>SPEED</Text>
            <Text style={styles.hudSpeed}>{speedText}</Text>
            <Text style={styles.hudUnit}>km/h</Text>
          </View>

          <View style={styles.hudCardWide}>
            <Text style={styles.hudSmall}>Mode: {mode === 'drive' ? 'Drive (GPS follow)' : 'Browse'}</Text>
            <Text style={styles.hudSmall} numberOfLines={1}>
              {route.length ? `Route points: ${route.length}` : 'No route loaded'}
            </Text>
            <Text style={styles.hudSmall} numberOfLines={1}>
              GPS: {locPerm}{servicesEnabled === null ? '' : servicesEnabled ? ' (on)' : ' (off)'}
              {location ? ` • ${location.coords.latitude.toFixed(5)}, ${location.coords.longitude.toFixed(5)}` : ''}
            </Text>
            {Platform.OS === 'android' ? (
              <Text style={styles.hudSmall} numberOfLines={1}>
                Tip: In emulator, set a location route via Extended Controls → Location.
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Note: This is a basic GPX overlay + GPS follow mode. It does not compute turn-by-turn routing.
        </Text>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigatorApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0b0f17',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    // paddingTop is applied dynamically using safe-area insets
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e2a40',
  },
  title: {
    color: '#e7eefc',
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: '#a9b7d6',
    marginTop: 2,
    fontSize: 12,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#24334d',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  btnText: {
    color: '#e7eefc',
    fontWeight: '700',
    fontSize: 13,
  },
  btnPrimary: {
    backgroundColor: '#7aa2ff',
    borderColor: '#7aa2ff',
  },
  btnPrimaryText: {
    color: '#0b0f17',
  },
  btnDanger: {
    backgroundColor: 'rgba(255,95,95,0.15)',
    borderColor: '#ff5f5f',
  },
  btnDangerText: {
    color: '#ffb3b3',
  },
  banner: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#24334d',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  bannerText: {
    color: '#e7eefc',
    fontSize: 12,
  },
  mapWrap: {
    flex: 1,
  },
  hud: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    flexDirection: 'row',
    gap: 10,
  },
  hudCard: {
    width: 110,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(10,16,29,0.75)',
    alignItems: 'center',
  },
  hudLabel: {
    color: '#a9b7d6',
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '800',
  },
  hudSpeed: {
    color: '#e7eefc',
    fontSize: 34,
    fontWeight: '900',
    marginTop: 2,
  },
  hudUnit: {
    color: '#7aa2ff',
    fontSize: 12,
    fontWeight: '800',
    marginTop: -2,
  },
  hudCardWide: {
    flex: 1,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(10,16,29,0.75)',
  },
  hudSmall: {
    color: '#a9b7d6',
    fontSize: 12,
    marginBottom: 4,
  },
  footer: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e2a40',
  },
  footerText: {
    color: '#a9b7d6',
    fontSize: 11,
  },
});
