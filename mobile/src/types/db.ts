export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_generation_usage_daily: {
        Row: {
          created_at: string
          mode: string
          updated_at: string
          usage_count: number
          usage_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          mode: string
          updated_at?: string
          usage_count?: number
          usage_date?: string
          user_id: string
        }
        Update: {
          created_at?: string
          mode?: string
          updated_at?: string
          usage_count?: number
          usage_date?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_push_queue: {
        Row: {
          created_at: string
          created_by_user_id: string
          event_id: string
          id: string
          message_id: string
          payload: Json
          process_error: string | null
          processed_at: string | null
          trigger_keyword: string | null
          trigger_type: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          event_id: string
          id?: string
          message_id: string
          payload?: Json
          process_error?: string | null
          processed_at?: string | null
          trigger_keyword?: string | null
          trigger_type: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          event_id?: string
          id?: string
          message_id?: string
          payload?: Json
          process_error?: string | null
          processed_at?: string | null
          trigger_keyword?: string | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_push_queue_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_push_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "event_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      event_chat_messages: {
        Row: {
          created_at: string
          event_id: string
          id: string
          message: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          message: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          message?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_chat_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_messages: {
        Row: {
          body: string
          created_at: string
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          event_id: string
          id?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          event_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_participants: {
        Row: {
          event_id: string
          joined_at: string | null
          user_id: string
        }
        Insert: {
          event_id: string
          joined_at?: string | null
          user_id: string
        }
        Update: {
          event_id?: string
          joined_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_presence: {
        Row: {
          created_at: string
          event_id: string
          joined_at: string | null
          last_seen_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          joined_at?: string | null
          last_seen_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          joined_at?: string | null
          last_seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_presence_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_run_state: {
        Row: {
          created_at: string
          event_id: string
          state: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          state?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          state?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_run_state_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_reads: {
        Row: {
          event_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          event_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          event_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_reads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_typing: {
        Row: {
          event_id: string
          is_typing: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          event_id: string
          is_typing?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          event_id?: string
          is_typing?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_typing_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          active_count_snapshot: number
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          duration_minutes: number
          end_time_utc: string
          guidance_mode: string
          host_user_id: string
          id: string
          intention: string
          intention_statement: string
          pinned_message: string | null
          script_id: string | null
          source: string
          source_fingerprint: string | null
          source_region: string | null
          start_time_utc: string
          starts_at: string
          status: string
          theme: string | null
          theme_id: string | null
          timezone: string
          title: string
          total_join_count: number
          visibility: string
        }
        Insert: {
          active_count_snapshot?: number
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          end_time_utc: string
          guidance_mode?: string
          host_user_id: string
          id?: string
          intention: string
          intention_statement: string
          pinned_message?: string | null
          script_id?: string | null
          source?: string
          source_fingerprint?: string | null
          source_region?: string | null
          start_time_utc: string
          starts_at: string
          status?: string
          theme?: string | null
          theme_id?: string | null
          timezone?: string
          title: string
          total_join_count?: number
          visibility?: string
        }
        Update: {
          active_count_snapshot?: number
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          end_time_utc?: string
          guidance_mode?: string
          host_user_id?: string
          id?: string
          intention?: string
          intention_statement?: string
          pinned_message?: string | null
          script_id?: string | null
          source?: string
          source_fingerprint?: string | null
          source_region?: string | null
          start_time_utc?: string
          starts_at?: string
          status?: string
          theme?: string | null
          theme_id?: string | null
          timezone?: string
          title?: string
          total_join_count?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      manifestation_journal_entries: {
        Row: {
          body: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: []
      }
      monetization_event_log: {
        Row: {
          created_at: string
          entitlement_id: string | null
          error_message: string | null
          event_name: string
          id: number
          is_circle_member: boolean | null
          metadata: Json
          package_identifier: string | null
          platform: string | null
          provider: string | null
          stage: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entitlement_id?: string | null
          error_message?: string | null
          event_name: string
          id?: never
          is_circle_member?: boolean | null
          metadata?: Json
          package_identifier?: string | null
          platform?: string | null
          provider?: string | null
          stage: string
          user_id: string
        }
        Update: {
          created_at?: string
          entitlement_id?: string | null
          error_message?: string | null
          event_name?: string
          id?: never
          is_circle_member?: boolean | null
          metadata?: Json
          package_identifier?: string | null
          platform?: string | null
          provider?: string | null
          stage?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string
          event_id: string | null
          id: string
          kind: string
          metadata: Json
          push_sent_at: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key: string
          event_id?: string | null
          id?: string
          kind: string
          metadata?: Json
          push_sent_at?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string
          event_id?: string | null
          id?: string
          kind?: string
          metadata?: Json
          push_sent_at?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      revenuecat_webhook_events: {
        Row: {
          app_user_id: string | null
          created_at: string
          entitlement_ids: string[]
          environment: string | null
          error_message: string | null
          event_id: string
          event_timestamp: string | null
          event_type: string
          metadata: Json
          process_status: string
          processed_at: string | null
          product_id: string | null
          raw_payload: Json
          received_at: string
          store: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          app_user_id?: string | null
          created_at?: string
          entitlement_ids?: string[]
          environment?: string | null
          error_message?: string | null
          event_id: string
          event_timestamp?: string | null
          event_type: string
          metadata?: Json
          process_status?: string
          processed_at?: string | null
          product_id?: string | null
          raw_payload?: Json
          received_at?: string
          store?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          app_user_id?: string | null
          created_at?: string
          entitlement_ids?: string[]
          environment?: string | null
          error_message?: string | null
          event_id?: string
          event_timestamp?: string | null
          event_type?: string
          metadata?: Json
          process_status?: string
          processed_at?: string | null
          product_id?: string | null
          raw_payload?: Json
          received_at?: string
          store?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      scripts: {
        Row: {
          author_user_id: string
          content_json: Json
          created_at: string
          duration_minutes: number
          id: string
          intention: string
          title: string
          tone: string
        }
        Insert: {
          author_user_id: string
          content_json?: Json
          created_at?: string
          duration_minutes?: number
          id?: string
          intention: string
          title: string
          tone?: string
        }
        Update: {
          author_user_id?: string
          content_json?: Json
          created_at?: string
          duration_minutes?: number
          id?: string
          intention?: string
          title?: string
          tone?: string
        }
        Relationships: []
      }
      themes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_subscription_state: {
        Row: {
          created_at: string
          entitlement_id: string
          environment: string | null
          expires_at: string | null
          is_active: boolean
          last_event_id: string | null
          last_event_timestamp: string | null
          last_event_type: string | null
          metadata: Json
          original_transaction_id: string | null
          product_id: string | null
          provider: string
          store: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entitlement_id?: string
          environment?: string | null
          expires_at?: string | null
          is_active?: boolean
          last_event_id?: string | null
          last_event_timestamp?: string | null
          last_event_type?: string | null
          metadata?: Json
          original_transaction_id?: string | null
          product_id?: string | null
          provider?: string
          store?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entitlement_id?: string
          environment?: string | null
          expires_at?: string | null
          is_active?: boolean
          last_event_id?: string | null
          last_event_timestamp?: string | null
          last_event_type?: string | null
          metadata?: Json
          original_transaction_id?: string | null
          product_id?: string | null
          provider?: string
          store?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_push_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_name: string | null
          expo_push_token: string
          id: string
          platform: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          expo_push_token: string
          id?: string
          platform?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          expo_push_token?: string
          id?: string
          platform?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notification_reads: {
        Row: {
          notification_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notification_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          notification_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notification_prefs: {
        Row: {
          created_at: string
          notify_friend_invites: boolean
          notify_live_start: boolean
          notify_news_events: boolean
          notify_streak_reminders: boolean
          show_community_feed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          notify_friend_invites?: boolean
          notify_live_start?: boolean
          notify_news_events?: boolean
          notify_streak_reminders?: boolean
          show_community_feed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          notify_friend_invites?: boolean
          notify_live_start?: boolean
          notify_news_events?: boolean
          notify_streak_reminders?: boolean
          show_community_feed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_ai_generation_quota: {
        Args: { p_mode: string }
        Returns: {
          allowed: boolean
          is_premium: boolean
          limit_daily: number | null
          remaining: number | null
          used_today: number
        }[]
      }
      contribute_heatmap_region: {
        Args: { p_region?: string }
        Returns: undefined
      }
      enqueue_chat_push_trigger: {
        Args: {
          p_event_id: string
          p_message: string
          p_message_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      get_ai_generation_quota: {
        Args: { p_mode: string }
        Returns: {
          allowed: boolean
          is_premium: boolean
          limit_daily: number | null
          remaining: number | null
          used_today: number
        }[]
      }
      get_event_active_count: {
        Args: { p_event_id: string; p_stale_seconds?: number }
        Returns: number
      }
      get_home_dashboard_snapshot: {
        Args: Record<PropertyKey, never>
        Returns: {
          active_global_events: number
          active_global_participants: number
          feed_items: Json
          previous_weekly_impact: number
          weekly_impact: number
        }[]
      }
      get_global_heatmap_snapshot: {
        Args: {
          p_max_events?: number
          p_max_manifestations?: number
          p_window?: string
        }
        Returns: {
          active_by_region: Json
          generated_at: string
          live_events: Json
          manifestations: Json
        }[]
      }
      get_monetization_funnel_summary: {
        Args: { p_user_id?: string }
        Returns: {
          ai_event_script_attempts: number
          ai_event_script_premium_success: number
          ai_event_script_success: number
          ai_solo_guidance_attempts: number
          ai_solo_guidance_premium_success: number
          ai_solo_guidance_success: number
          debug_open_count: number
          membership_sync_failure: number
          membership_sync_success: number
          paywall_cta_taps: number
          paywall_views: number
          purchase_attempts: number
          purchase_cancelled: number
          purchase_failure: number
          purchase_success: number
          refresh_attempts: number
          refresh_success: number
          restore_attempts: number
          restore_failure: number
          restore_success: number
        }[]
      }
      get_profile_live_stats: {
        Args: { p_user_id?: string }
        Returns: {
          active_days_30: number
          active_participants_now: number
          intention_energy: number
          live_events_now: number
          prayers_week: number
          rhythm_fri: number
          rhythm_mon: number
          rhythm_sat: number
          rhythm_sun: number
          rhythm_thu: number
          rhythm_tue: number
          rhythm_wed: number
          shared_intentions_week: number
          streak_days: number
        }[]
      }
      get_shared_manifestation_feed: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          created_at: string
          display_name: string
          event_id: string
          event_title: string
          id: string
          source: string
          user_id: string
        }[]
      }
      is_circle_member: {
        Args: { p_user_id?: string }
        Returns: boolean
      }
      queue_shared_manifestation_notifications: {
        Args: {
          p_lookback_minutes?: number
          p_max_entries?: number
          p_max_recipients?: number
        }
        Returns: number
      }
      queue_live_event_notifications: {
        Args: {
          p_lookahead_minutes?: number
          p_recent_participant_days?: number
          p_max_events?: number
          p_max_recipients_per_event?: number
        }
        Returns: number
      }
      queue_live_now_notifications: {
        Args: {
          p_lookback_minutes?: number
          p_recent_participant_days?: number
          p_max_events?: number
          p_max_recipients_per_event?: number
        }
        Returns: number
      }
      queue_news_event_notifications: {
        Args: {
          p_lookback_hours?: number
          p_recent_participant_days?: number
          p_max_events?: number
          p_max_recipients_per_event?: number
        }
        Returns: number
      }
      queue_streak_reminder_notifications: {
        Args: {
          p_max_recipients?: number
          p_recent_participant_days?: number
        }
        Returns: number
      }
      set_event_run_state: {
        Args: {
          p_elapsed_before_pause_sec?: number
          p_event_id: string
          p_mode: string
          p_reset_timer?: boolean
          p_section_index: number
        }
        Returns: {
          created_at: string
          event_id: string
          state: Json
          updated_at: string
        }
      }
      trigger_dispatch_chat_push_job: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      trigger_dispatch_notification_log_push_job: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      trigger_news_auto_events_job: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

