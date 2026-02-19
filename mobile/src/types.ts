// mobile/src/types.ts

export type RootTabParamList = {
  Events: undefined;
  Scripts: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  RootTabs: undefined;
  EventRoom: { eventId: string };
};
