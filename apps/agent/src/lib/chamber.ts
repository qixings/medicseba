import { useServerChange } from './live';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, API_URL, ApiError, getAuthToken } from './api';

export type Sitting = { scheduleId: string; weekdays: number[]; startTime: string; tokenLimit: number };
export type ChamberDoctor = {
  id: string; name: string; photoUrl: string | null; degrees: string; specialtyId: string; specialty: string;
  experienceYears: number; consultFee: number; languages: string[]; bio: string; sitting: Sitting;
};
export type Request = { id: string; kind: 'new_doctor' | 'doctor_update' | 'fees'; targetId: string | null; data: Record<string, any>; status: 'PENDING' | 'APPROVED' | 'REJECTED'; note: string | null; createdAt: string };
export type ChamberInfo = {
  chamber: { id: string; name: string; kind: string; address: string; area: string; landmark: string; phone: string; openingHours: string; bookingFee: number; platformFee: number; photos: string[]; lat: number | null; lng: number | null };
  doctors: ChamberDoctor[];
  requests: Request[];
  specialties: { id: string; name: string }[];
};

/** The chamber's own details for the Doctors and Chamber tabs. */
export function useChamber() {
  const [data, setData] = useState<ChamberInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setData(await api<ChamberInfo>('/agent/chamber')); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // Approvals from MedicSeba, or another counter phone editing details, show up without a refresh.
  useServerChange(['catalog', 'requests'], () => { void reload(); });
  return { data, error, reload };
}

/** Pick a photo from the phone or computer and upload it to the chamber. */
export async function pickAndUploadPhoto() {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
  if (r.canceled || !r.assets[0]) return false;
  const a = r.assets[0];
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(a.uri)).blob();
    form.append('photo', blob, a.fileName ?? 'photo.jpg');
  } else {
    form.append('photo', { uri: a.uri, name: a.fileName ?? 'photo.jpg', type: a.mimeType ?? 'image/jpeg' } as unknown as Blob);
  }
  const res = await fetch(`${API_URL}/v1/agent/chamber/photos`, { method: 'POST', headers: { authorization: `Bearer ${getAuthToken()}` }, body: form });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new ApiError(res.status, d.error ?? 'error', d.message ?? 'Upload failed');
  }
  return true;
}
