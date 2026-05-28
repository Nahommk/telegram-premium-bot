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
      abuse_logs: {
        Row: {
          created_at: string
          id: string
          kind: string
          meta: Json | null
          user_telegram_id: number
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          meta?: Json | null
          user_telegram_id: number
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          meta?: Json | null
          user_telegram_id?: number
          weight?: number
        }
        Relationships: []
      }
      admin_sessions: {
        Row: {
          state: Json
          telegram_id: number
          updated_at: string
        }
        Insert: {
          state?: Json
          telegram_id: number
          updated_at?: string
        }
        Update: {
          state?: Json
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      admins: {
        Row: {
          added_by_telegram_id: number | null
          created_at: string
          note: string | null
          telegram_id: number
        }
        Insert: {
          added_by_telegram_id?: number | null
          created_at?: string
          note?: string | null
          telegram_id: number
        }
        Update: {
          added_by_telegram_id?: number | null
          created_at?: string
          note?: string | null
          telegram_id?: number
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          admin_telegram_id: number
          created_at: string
          id: string
          target: Json | null
        }
        Insert: {
          action: string
          admin_telegram_id: number
          created_at?: string
          id?: string
          target?: Json | null
        }
        Update: {
          action?: string
          admin_telegram_id?: number
          created_at?: string
          id?: string
          target?: Json | null
        }
        Relationships: []
      }
      bot_users: {
        Row: {
          abuse_score: number
          auto_banned_until: string | null
          banned_reason: string | null
          created_at: string
          first_name: string | null
          id: string
          is_banned: boolean
          language_code: string | null
          last_name: string | null
          referred_by_telegram_id: number | null
          telegram_id: number
          updated_at: string
          username: string | null
        }
        Insert: {
          abuse_score?: number
          auto_banned_until?: string | null
          banned_reason?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          is_banned?: boolean
          language_code?: string | null
          last_name?: string | null
          referred_by_telegram_id?: number | null
          telegram_id: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          abuse_score?: number
          auto_banned_until?: string | null
          banned_reason?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          is_banned?: boolean
          language_code?: string | null
          last_name?: string | null
          referred_by_telegram_id?: number | null
          telegram_id?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      broadcast_targets: {
        Row: {
          broadcast_id: string
          error: string | null
          sent_at: string | null
          status: string
          telegram_id: number
        }
        Insert: {
          broadcast_id: string
          error?: string | null
          sent_at?: string | null
          status?: string
          telegram_id: number
        }
        Update: {
          broadcast_id?: string
          error?: string | null
          sent_at?: string | null
          status?: string
          telegram_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_targets_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          admin_telegram_id: number
          buttons: Json | null
          created_at: string
          failed: number
          id: string
          kind: string
          photo_file_id: string | null
          progress_chat_id: number | null
          progress_message_id: number | null
          sent: number
          status: string
          text: string | null
          total: number
          updated_at: string
        }
        Insert: {
          admin_telegram_id: number
          buttons?: Json | null
          created_at?: string
          failed?: number
          id?: string
          kind: string
          photo_file_id?: string | null
          progress_chat_id?: number | null
          progress_message_id?: number | null
          sent?: number
          status?: string
          text?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          admin_telegram_id?: number
          buttons?: Json | null
          created_at?: string
          failed?: number
          id?: string
          kind?: string
          photo_file_id?: string | null
          progress_chat_id?: number | null
          progress_message_id?: number | null
          sent?: number
          status?: string
          text?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      button_templates: {
        Row: {
          emoji: string
          is_visible: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          emoji?: string
          is_visible?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          emoji?: string
          is_visible?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          body: string
          key: string
          updated_at: string
        }
        Insert: {
          body: string
          key: string
          updated_at?: string
        }
        Update: {
          body?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivered_by_admin_id: number | null
          delivered_code: string | null
          delivery_content_type: string | null
          delivery_timestamp: string | null
          expires_at: string
          id: string
          manual_delivery_status: Database["public"]["Enums"]["manual_delivery_status"]
          notes: string | null
          paid_from_wallet: boolean
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          product_id: string
          quantity: number
          referrer_telegram_id: number | null
          short_id: string
          status: Database["public"]["Enums"]["order_status"]
          total_cents: number
          unit_price_cents: number
          updated_at: string
          user_telegram_id: number
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivered_by_admin_id?: number | null
          delivered_code?: string | null
          delivery_content_type?: string | null
          delivery_timestamp?: string | null
          expires_at?: string
          id?: string
          manual_delivery_status?: Database["public"]["Enums"]["manual_delivery_status"]
          notes?: string | null
          paid_from_wallet?: boolean
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          product_id: string
          quantity: number
          referrer_telegram_id?: number | null
          short_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          total_cents: number
          unit_price_cents: number
          updated_at?: string
          user_telegram_id: number
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivered_by_admin_id?: number | null
          delivered_code?: string | null
          delivery_content_type?: string | null
          delivery_timestamp?: string | null
          expires_at?: string
          id?: string
          manual_delivery_status?: Database["public"]["Enums"]["manual_delivery_status"]
          notes?: string | null
          paid_from_wallet?: boolean
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          product_id?: string
          quantity?: number
          referrer_telegram_id?: number | null
          short_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          total_cents?: number
          unit_price_cents?: number
          updated_at?: string
          user_telegram_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          created_at: string
          error: string | null
          id: string
          order_id: string | null
          reference: string | null
          status: string
          user_telegram_id: number
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          order_id?: string | null
          reference?: string | null
          status: string
          user_telegram_id: number
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          order_id?: string | null
          reference?: string | null
          status?: string
          user_telegram_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          id: string
          order_id: string | null
          provider: Database["public"]["Enums"]["payment_method"]
          raw_response: Json | null
          reference: string
          verified_at: string
        }
        Insert: {
          amount_cents: number
          id?: string
          order_id?: string | null
          provider: Database["public"]["Enums"]["payment_method"]
          raw_response?: Json | null
          reference: string
          verified_at?: string
        }
        Update: {
          amount_cents?: number
          id?: string
          order_id?: string | null
          provider?: Database["public"]["Enums"]["payment_method"]
          raw_response?: Json | null
          reference?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          is_used: boolean
          product_id: string
          used_at: string | null
          used_by_order_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_used?: boolean
          product_id: string
          used_at?: string | null
          used_by_order_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_used?: boolean
          product_id?: string
          used_at?: string | null
          used_by_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          delivery_mode: Database["public"]["Enums"]["delivery_mode"]
          description: string
          icon: string
          id: string
          is_enabled: boolean
          name: string
          price_cents: number
          quantity_presets: Json
          sort_order: number
          updated_at: string
          warranty_text: string
        }
        Insert: {
          created_at?: string
          delivery_mode?: Database["public"]["Enums"]["delivery_mode"]
          description?: string
          icon?: string
          id?: string
          is_enabled?: boolean
          name: string
          price_cents: number
          quantity_presets?: Json
          sort_order?: number
          updated_at?: string
          warranty_text?: string
        }
        Update: {
          created_at?: string
          delivery_mode?: Database["public"]["Enums"]["delivery_mode"]
          description?: string
          icon?: string
          id?: string
          is_enabled?: boolean
          name?: string
          price_cents?: number
          quantity_presets?: Json
          sort_order?: number
          updated_at?: string
          warranty_text?: string
        }
        Relationships: []
      }
      receipt_hashes: {
        Row: {
          created_at: string
          order_id: string | null
          sha256: string
          uploaded_by_telegram_id: number
        }
        Insert: {
          created_at?: string
          order_id?: string | null
          sha256: string
          uploaded_by_telegram_id: number
        }
        Update: {
          created_at?: string
          order_id?: string | null
          sha256?: string
          uploaded_by_telegram_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipt_hashes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_rewards: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          order_id: string
          paid_to_wallet: boolean
          referee_telegram_id: number
          referrer_telegram_id: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          order_id: string
          paid_to_wallet?: boolean
          referee_telegram_id: number
          referrer_telegram_id: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          order_id?: string
          paid_to_wallet?: boolean
          referee_telegram_id?: number
          referrer_telegram_id?: number
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referee_telegram_id: number
          referrer_telegram_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          referee_telegram_id: number
          referrer_telegram_id: number
        }
        Update: {
          created_at?: string
          id?: string
          referee_telegram_id?: number
          referrer_telegram_id?: number
        }
        Relationships: []
      }
      security_events: {
        Row: {
          created_at: string
          event: string
          id: string
          meta: Json | null
          user_telegram_id: number | null
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          meta?: Json | null
          user_telegram_id?: number | null
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          meta?: Json | null
          user_telegram_id?: number | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount_cents: number
          balance_after_cents: number
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["wallet_tx_kind"]
          note: string | null
          ref_order_id: string | null
          ref_payment_id: string | null
          user_telegram_id: number
        }
        Insert: {
          amount_cents: number
          balance_after_cents: number
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["wallet_tx_kind"]
          note?: string | null
          ref_order_id?: string | null
          ref_payment_id?: string | null
          user_telegram_id: number
        }
        Update: {
          amount_cents?: number
          balance_after_cents?: number
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["wallet_tx_kind"]
          note?: string | null
          ref_order_id?: string | null
          ref_payment_id?: string | null
          user_telegram_id?: number
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance_cents: number
          created_at: string
          updated_at: string
          user_telegram_id: number
        }
        Insert: {
          balance_cents?: number
          created_at?: string
          updated_at?: string
          user_telegram_id: number
        }
        Update: {
          balance_cents?: number
          created_at?: string
          updated_at?: string
          user_telegram_id?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _ensure_wallet: { Args: { p_user: number }; Returns: undefined }
      admin_wallet_adjust: {
        Args: {
          p_admin: number
          p_amount: number
          p_note?: string
          p_user: number
        }
        Returns: number
      }
      deposit_to_wallet: {
        Args: {
          p_amount: number
          p_provider: Database["public"]["Enums"]["payment_method"]
          p_raw: Json
          p_reference: string
          p_user: number
        }
        Returns: number
      }
      grant_referral_reward: { Args: { p_order_id: string }; Returns: number }
      manual_deliver: {
        Args: {
          p_admin: number
          p_code?: string
          p_content_type: string
          p_order_id: string
        }
        Returns: {
          short_id: string
          user_telegram_id: number
        }[]
      }
      pay_order_from_wallet: {
        Args: { p_order_id: string; p_user: number }
        Returns: {
          delivered_code: string
          delivery_mode: Database["public"]["Enums"]["delivery_mode"]
          short_id: string
          status: Database["public"]["Enums"]["order_status"]
        }[]
      }
      process_payment: {
        Args: {
          p_amount_cents: number
          p_order_id: string
          p_provider: Database["public"]["Enums"]["payment_method"]
          p_raw: Json
          p_reference: string
        }
        Returns: {
          delivered_code: string
          delivery_mode: Database["public"]["Enums"]["delivery_mode"]
          short_id: string
          status: Database["public"]["Enums"]["order_status"]
        }[]
      }
      referral_payout: { Args: { p_user: number }; Returns: number }
      refund_order: {
        Args: { p_admin: number; p_order_id: string; p_reason: string }
        Returns: {
          refunded_cents: number
          short_id: string
          user_telegram_id: number
        }[]
      }
      reject_order: {
        Args: { p_admin: number; p_order_id: string; p_reason: string }
        Returns: {
          refunded_cents: number
          short_id: string
          user_telegram_id: number
        }[]
      }
      wallet_credit: {
        Args: {
          p_amount: number
          p_kind: Database["public"]["Enums"]["wallet_tx_kind"]
          p_note?: string
          p_order?: string
          p_payment?: string
          p_user: number
        }
        Returns: number
      }
      wallet_debit: {
        Args: {
          p_amount: number
          p_kind: Database["public"]["Enums"]["wallet_tx_kind"]
          p_note?: string
          p_order?: string
          p_user: number
        }
        Returns: number
      }
    }
    Enums: {
      delivery_mode: "automatic" | "manual"
      manual_delivery_status: "none" | "pending" | "delivered" | "rejected"
      order_status:
        | "pending"
        | "paid"
        | "delivered"
        | "failed"
        | "expired"
        | "refunded"
        | "paid_waiting_delivery"
        | "rejected"
      payment_method: "telebirr" | "cbe"
      wallet_tx_kind:
        | "deposit"
        | "order_payment"
        | "refund"
        | "referral_payout"
        | "admin_adjust"
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
    Enums: {
      delivery_mode: ["automatic", "manual"],
      manual_delivery_status: ["none", "pending", "delivered", "rejected"],
      order_status: [
        "pending",
        "paid",
        "delivered",
        "failed",
        "expired",
        "refunded",
        "paid_waiting_delivery",
        "rejected",
      ],
      payment_method: ["telebirr", "cbe"],
      wallet_tx_kind: [
        "deposit",
        "order_payment",
        "refund",
        "referral_payout",
        "admin_adjust",
      ],
    },
  },
} as const
