// mobile/src/types.ts

export type RootTabParamList = {
  Home: undefined;
  Global: undefined;
  Events: undefined;
  Scripts: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  RootTabs: undefined;
  EventRoom: { eventId: string };
};
