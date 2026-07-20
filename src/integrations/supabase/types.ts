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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      automation_log_steps: {
        Row: {
          api_response: Json | null
          api_status_code: number | null
          context: Json | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          label: string
          log_id: string
          status: string
          step: string
          user_id: string
        }
        Insert: {
          api_response?: Json | null
          api_status_code?: number | null
          context?: Json | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          label: string
          log_id: string
          status?: string
          step: string
          user_id: string
        }
        Update: {
          api_response?: Json | null
          api_status_code?: number | null
          context?: Json | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          label?: string
          log_id?: string
          status?: string
          step?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_log_steps_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: false
            referencedRelation: "automation_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          automation_id: string | null
          comment_text: string | null
          created_at: string
          error: string | null
          event_type: string | null
          finished_at: string | null
          id: string
          instagram_post_id: string | null
          instagram_user: string | null
          message_sent: string | null
          status: string
          stopped_at_step: string | null
          total_duration_ms: number | null
          trigger_keyword: string | null
          user_id: string
        }
        Insert: {
          automation_id?: string | null
          comment_text?: string | null
          created_at?: string
          error?: string | null
          event_type?: string | null
          finished_at?: string | null
          id?: string
          instagram_post_id?: string | null
          instagram_user?: string | null
          message_sent?: string | null
          status?: string
          stopped_at_step?: string | null
          total_duration_ms?: number | null
          trigger_keyword?: string | null
          user_id: string
        }
        Update: {
          automation_id?: string | null
          comment_text?: string | null
          created_at?: string
          error?: string | null
          event_type?: string | null
          finished_at?: string | null
          id?: string
          instagram_post_id?: string | null
          instagram_user?: string | null
          message_sent?: string | null
          status?: string
          stopped_at_step?: string | null
          total_duration_ms?: number | null
          trigger_keyword?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          buttons: Json
          created_at: string
          custom_message: string
          delay_max_seconds: number
          delay_min_seconds: number
          followup_message: string
          id: string
          instagram_post_id: string
          instagram_post_type: string
          is_active: boolean
          keyword_filter_enabled: boolean
          keywords: string[]
          name: string
          quick_replies: Json
          total_failed: number
          total_sent: number
          trigger_on_dm: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          buttons?: Json
          created_at?: string
          custom_message?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          followup_message?: string
          id?: string
          instagram_post_id: string
          instagram_post_type?: string
          is_active?: boolean
          keyword_filter_enabled?: boolean
          keywords?: string[]
          name: string
          quick_replies?: Json
          total_failed?: number
          total_sent?: number
          trigger_on_dm?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          buttons?: Json
          created_at?: string
          custom_message?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          followup_message?: string
          id?: string
          instagram_post_id?: string
          instagram_post_type?: string
          is_active?: boolean
          keyword_filter_enabled?: boolean
          keywords?: string[]
          name?: string
          quick_replies?: Json
          total_failed?: number
          total_sent?: number
          trigger_on_dm?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string | null
          updated_at: string
          webhook_token: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          name?: string | null
          updated_at?: string
          webhook_token?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          updated_at?: string
          webhook_token?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          instagram_connected: boolean
          instagram_username: string | null
          outgoing_webhook_enabled: boolean
          outgoing_webhook_url: string | null
          published_origin: string | null
          updated_at: string
          user_id: string
          zernio_account_id: string | null
          zernio_api_key_encrypted: string | null
        }
        Insert: {
          created_at?: string
          instagram_connected?: boolean
          instagram_username?: string | null
          outgoing_webhook_enabled?: boolean
          outgoing_webhook_url?: string | null
          published_origin?: string | null
          updated_at?: string
          user_id: string
          zernio_account_id?: string | null
          zernio_api_key_encrypted?: string | null
        }
        Update: {
          created_at?: string
          instagram_connected?: boolean
          instagram_username?: string | null
          outgoing_webhook_enabled?: boolean
          outgoing_webhook_url?: string | null
          published_origin?: string | null
          updated_at?: string
          user_id?: string
          zernio_account_id?: string | null
          zernio_api_key_encrypted?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
