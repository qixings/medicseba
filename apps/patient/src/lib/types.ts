export type Specialty = { slug: string; name: string; icon: string | null; doctors?: number };

export type ChamberKind = 'PHARMACY' | 'OWN';

export type Chamber = {
  id: string;
  name: string;
  kind: ChamberKind;
  photos: string[];
  address: string;
  area: string;
  landmark: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  openingHours: string;
  openNow: boolean | null;
  bookingFee: number;
  platformFee: number;
  total: number;
  doctorsToday?: number;
  doctorInitials?: string[];
};

export type DoctorStatus = 'ON_TIME' | 'LATE' | 'ARRIVED' | 'BREAK' | 'NOT_COMING' | 'ENDED';

export type Session = {
  id: string;
  date: string;
  time: string;
  startTime: string;
  startsAt: string;
  chamber: { id: string; name: string; area: string };
  tokensLeft: number;
  full: boolean;
  bookable: boolean;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'ENDED';
  doctorStatus: DoctorStatus;
};

export type Doctor = {
  id: string;
  name: string;
  photoUrl: string | null;
  degrees: string;
  specialty: { slug: string; name: string };
  experienceYears: number;
  consultFee: number;
  languages: string[];
  bio: string;
  bookingWindowDays: number;
  rating: number | null;
  ratingCount: number;
};

export type DoctorWithSessions = Doctor & { sessions: Session[] };
export type DoctorDetail = Doctor & {
  chambers: (Chamber & { weekdays: number[]; time: string })[];
  week: Session[];
};
export type ChamberDetail = Chamber & {
  doctors: (Doctor & { weekdays: number[]; time: string })[];
  today: (Session & { doctorId: string })[];
};

export type TokenState =
  | 'HELD' | 'BOOKED' | 'ARRIVED' | 'SERVING' | 'DONE' | 'MISSED' | 'NO_SHOW' | 'CANCELLED' | 'REFUNDED' | 'MOVED' | 'EXPIRED';

export type Live = {
  token: { id: string; number: number | null; state: TokenState; patientName: string; absentChoice: string | null; rescheduleUsed: boolean; missCount: number; source: 'ONLINE' | 'WALKIN' };
  session: {
    id: string; date: string; time: string; startsAt: string; status: Session['status'];
    doctorStatus: DoctorStatus; lateMinutes: number; servingNumber: number; totalTokens: number; seen: number; tokenLimit: number;
  };
  doctor: { id: string; name: string; photoUrl: string | null };
  chamber: { id: string; name: string; area: string; address: string; lat: number | null; lng: number | null };
  ahead: number;
  minutesPerPatient: number;
  waitMinutes: number;
};

export type Home = {
  date: string;
  sittingToday: number;
  activeToken: Live | null;
  specialties: Specialty[];
  chambers: Chamber[];
  sessionsToday: (Session & { doctor: Doctor })[];
};

export type Booking = {
  id: string; number: number | null; state: TokenState; patientName: string; rescheduleUsed: boolean; absentChoice: string | null;
  date: string; time: string; startsAt: string; sessionId: string; doctorStatus: DoctorStatus; servingNumber: number;
  doctor: { id: string; name: string; photoUrl: string | null };
  chamber: { id: string; name: string; area: string };
  amount: number | null; paymentStatus: string | null;
};

export type Member = { id: string; name: string; age: number; gender: 'MALE' | 'FEMALE' | 'OTHER'; relation: string | null; isSelf: boolean };
export type Me = { id: string; phone: string; name: string | null; language: 'en' | 'bn'; members: number };

export type Hold = {
  tokenId: string; holdExpiresAt: string; amount: number; bookingFee: number; platformFee: number;
  order: { provider: 'mock' | 'razorpay'; orderId: string; amount: number; currency: string; keyId?: string };
};

export type Note = { id: string; kind: string; title: string; body: string; data: Record<string, unknown>; read: boolean; createdAt: string };
