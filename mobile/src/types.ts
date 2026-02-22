// mobile/src/types.ts

export type RootTabParamList = {
  Home:
    | {
        openSolo?: boolean;
        soloPreset?: string;
        soloTitle?: string;
        soloLines?: string[];
        soloCategory?: string;
        soloMinutes?: 3 | 5 | 10;
      }
    | undefined;
  Solo: undefined;
  Events:
    | {
        openCreate?: boolean;
        prefillTitle?: string;
        prefillIntention?: string;
        prefillDescription?: string;
        prefillMinutes?: number;
      }
    | undefined;
  Profile: undefined;
  Global: undefined;
  Scripts: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  RootTabs: undefined;
  Notifications: undefined;
  BillingDebug: undefined;
  EgregorCircle: undefined;
  CommunityChat: undefined;
  DirectChat: {
    peerUserId: string;
    peerDisplayName?: string;
  };
  EventRoom: { eventId: string };
  SoloSession:
    | {
        title?: string;
        intention?: string;
        lines?: string[];
        category?: string;
        minutes?: 3 | 5 | 10;
      }
    | undefined;
  JournalCompose:
    | {
        prefill?: string;
        source?: "solo" | "event" | "manual";
        suggestedEvent?: {
          title?: string;
          intention?: string;
          description?: string;
          minutes?: number;
        };
      }
    | undefined;
};
