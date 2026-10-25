/**
 * SiteQuote public schema contract, including Phase 3C prepared quote versions. Foundation tables in
 * supabase/migrations/20261022000000_foundation_tables.sql.
 * After applying a migration, compare this with:
 *   supabase gen types typescript --local --schema public
 * Phase 1A also includes append-only activities; compare types after migration.
 */
export type Database = {
  public: {
    Tables: {
      business_profiles: {
        Row: {
          user_id: string;
          business_name: string;
          phone: string | null;
          address: string | null;
        };
        Insert: {
          user_id: string;
          business_name: string;
          phone?: string | null;
          address?: string | null;
        };
        Update: {
          user_id?: string;
          business_name?: string;
          phone?: string | null;
          address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'business_profiles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      leads: {
        Row: {
          id: string;
          user_id: string;
          customer_name: string;
          phone: string | null;
          email: string | null;
          source: Database['public']['Enums']['lead_source'];
          notes: string | null;
          contact_stage: Database['public']['Enums']['lead_contact_stage'];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          customer_name: string;
          phone?: string | null;
          email?: string | null;
          source: Database['public']['Enums']['lead_source'];
          notes?: string | null;
          contact_stage?: Database['public']['Enums']['lead_contact_stage'];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          customer_name?: string;
          phone?: string | null;
          email?: string | null;
          source?: Database['public']['Enums']['lead_source'];
          notes?: string | null;
          contact_stage?: Database['public']['Enums']['lead_contact_stage'];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      activities: {
        Row: {
          id: string;
          user_id: string;
          lead_id: string;
          project_id: string | null;
          type: string;
          detail: { note: string } | { project_title: string; from_status: string; to_status: string; previous_accepted_quote_id: string | null };
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          lead_id: string;
          project_id?: string | null;
          type: string;
          detail: { note: string } | { project_title: string; from_status: string; to_status: string; previous_accepted_quote_id: string | null };
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          lead_id?: string;
          project_id?: string | null;
          type?: string;
          detail?: { note: string };
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'activities_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'activities_owner_lead_fkey';
            columns: ['user_id', 'lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['user_id', 'id'];
          }
        ];
      };
      project_tasks: {
        Row: {
          id: string;
          user_id: string;
          project_id: string;
          category: string;
          title: string;
          notes: string | null;
          amount_minor: number;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id: string;
          category: string;
          title: string;
          notes?: string | null;
          amount_minor?: number;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          project_id?: string;
          category?: string;
          title?: string;
          notes?: string | null;
          amount_minor?: number;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_tasks_owner_project_fkey';
            columns: ['user_id', 'project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['user_id', 'id'];
          }
        ];
      };
      project_additional_charges: {
        Row: {
          id: string; user_id: string; project_id: string; description: string;
          amount_minor: number; sort_order: number; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; user_id: string; project_id: string; description: string;
          amount_minor: number; sort_order?: number; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; user_id?: string; project_id?: string; description?: string;
          amount_minor?: number; sort_order?: number; created_at?: string; updated_at?: string;
        };
        Relationships: [{
          foreignKeyName: 'project_additional_charges_owner_project_fk';
          columns: ['user_id', 'project_id']; isOneToOne: false;
          referencedRelation: 'projects'; referencedColumns: ['user_id', 'id'];
        }];
      };
      project_photos: {
        Row: {
          id: string; user_id: string; project_id: string; task_id: string | null;
          storage_path: string; source: 'site_visit' | 'client_provided';
          state: 'active' | 'deleting'; created_at: string; updated_at: string;
        };
        Insert: {
          id: string; user_id: string; project_id: string; task_id?: string | null;
          storage_path: string; source: 'site_visit' | 'client_provided';
          state?: 'active' | 'deleting'; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; user_id?: string; project_id?: string; task_id?: string | null;
          storage_path?: string; source?: 'site_visit' | 'client_provided';
          state?: 'active' | 'deleting'; created_at?: string; updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'project_photos_owner_project_fk'; columns: ['user_id', 'project_id'];
            isOneToOne: false; referencedRelation: 'projects'; referencedColumns: ['user_id', 'id']; },
          { foreignKeyName: 'project_photos_matching_task_fk'; columns: ['user_id', 'project_id', 'task_id'];
            isOneToOne: false; referencedRelation: 'project_tasks'; referencedColumns: ['user_id', 'project_id', 'id']; }
        ];
      };
      quotes: {
        Row: {
          id: string; user_id: string; project_id: string; version: number;
          status: 'prepared' | 'sent'; fingerprint: string; snapshot: Record<string, unknown>;
          request_key: string; tasks_subtotal_minor: number; charges_total_minor: number;
          tax_bps: number; tax_minor: number; total_minor: number;
          issued_at: string; sent_at: string | null;
        };
        Insert: {
          id?: string; user_id: string; project_id: string; version: number;
          status?: 'prepared' | 'sent'; fingerprint: string; snapshot: Record<string, unknown>;
          request_key: string; tasks_subtotal_minor: number; charges_total_minor: number;
          tax_bps: number; tax_minor: number; total_minor: number;
          issued_at?: string; sent_at?: string | null;
        };
        Update: {
          id?: string; user_id?: string; project_id?: string; version?: number;
          status?: 'prepared' | 'sent'; fingerprint?: string; snapshot?: Record<string, unknown>;
          request_key?: string; tasks_subtotal_minor?: number; charges_total_minor?: number;
          tax_bps?: number; tax_minor?: number; total_minor?: number;
          issued_at?: string; sent_at?: string | null;
        };
        Relationships: [{
          foreignKeyName: 'quotes_project_owner'; columns: ['user_id', 'project_id'];
          isOneToOne: false; referencedRelation: 'projects'; referencedColumns: ['user_id', 'id'];
        }];
      };
      quote_prepare_requests: {
        Row: { user_id: string; request_key: string; project_id: string; quote_id: string; fingerprint: string };
        Insert: { user_id: string; request_key: string; project_id: string; quote_id: string; fingerprint: string };
        Update: { user_id?: string; request_key?: string; project_id?: string; quote_id?: string; fingerprint?: string };
        Relationships: [{
          foreignKeyName: 'quote_prepare_requests_user_id_project_id_quote_id_fkey';
          columns: ['user_id','project_id','quote_id']; isOneToOne: false;
          referencedRelation: 'quotes'; referencedColumns: ['user_id','project_id','id'];
        }];
      };
      reminder_completion_events: {
        Row: {
          id: string; user_id: string; reminder_id: string;
          event_type: 'completed' | 'reopened'; occurred_at: string;
          lead_id: string; project_id: string | null;
          reminder_title: string; reminder_kind: 'site_visit' | 'follow_up' | 'other';
          reminder_due_at: string;
        };
        Insert: {
          id?: string; user_id: string; reminder_id: string;
          event_type: 'completed' | 'reopened'; occurred_at: string;
          lead_id: string; project_id?: string | null;
          reminder_title: string; reminder_kind: 'site_visit' | 'follow_up' | 'other';
          reminder_due_at: string;
        };
        Update: {
          id?: string; user_id?: string; reminder_id?: string;
          event_type?: 'completed' | 'reopened'; occurred_at?: string;
          lead_id?: string; project_id?: string | null;
          reminder_title?: string; reminder_kind?: 'site_visit' | 'follow_up' | 'other';
          reminder_due_at?: string;
        };
        Relationships: [{
          foreignKeyName: 'reminder_events_owner_reminder_fk';
          columns: ['user_id', 'reminder_id']; isOneToOne: false;
          referencedRelation: 'reminders'; referencedColumns: ['user_id', 'id'];
        }];
      };
      reminders: {
        Row: {
          id: string; user_id: string; lead_id: string; project_id: string | null;
          kind: 'site_visit' | 'follow_up' | 'other'; title: string; note: string | null;
          due_at: string; status: 'open' | 'completed'; completed_at: string | null;
          created_at: string; updated_at: string; client_request_id: string | null;
        };
        Insert: {
          id?: string; user_id: string; lead_id: string; project_id?: string | null;
          kind: 'site_visit' | 'follow_up' | 'other'; title: string; note?: string | null;
          due_at: string; status?: 'open' | 'completed'; completed_at?: string | null;
          created_at?: string; updated_at?: string; client_request_id?: string | null;
        };
        Update: {
          id?: string; user_id?: string; lead_id?: string; project_id?: string | null;
          kind?: 'site_visit' | 'follow_up' | 'other'; title?: string; note?: string | null;
          due_at?: string; status?: 'open' | 'completed'; completed_at?: string | null;
          created_at?: string; updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'reminders_owner_lead_fkey'; columns: ['user_id','lead_id'];
            isOneToOne: false; referencedRelation: 'leads'; referencedColumns: ['user_id','id'] },
          { foreignKeyName: 'reminders_owner_lead_project_fkey'; columns: ['user_id','lead_id','project_id'];
            isOneToOne: false; referencedRelation: 'projects'; referencedColumns: ['user_id','lead_id','id'] }
        ];
      };
      projects: {
        Row: {
          id: string;
          user_id: string;
          lead_id: string;
          title: string;
          site_address: string | null;
          notes: string | null;
          status: Database['public']['Enums']['project_status'];
          accepted_quote_id: string | null;
          tax_bps: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          lead_id: string;
          title: string;
          site_address?: string | null;
          notes?: string | null;
          status?: Database['public']['Enums']['project_status'];
          accepted_quote_id?: string | null;
          tax_bps?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          lead_id?: string;
          title?: string;
          site_address?: string | null;
          notes?: string | null;
          status?: Database['public']['Enums']['project_status'];
          accepted_quote_id?: string | null;
          tax_bps?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'projects_owner_lead_fkey';
            columns: ['user_id', 'lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['user_id', 'id'];
          }
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      confirm_quote_sent_for_followup: {
        Args: { p_quote_id: string };
        Returns: { transitioned: boolean; quote: Database['public']['Tables']['quotes']['Row'] };
      };
      confirm_quote_sent: {
        Args: { p_quote_id: string };
        Returns: Database['public']['Tables']['quotes']['Row'];
      };
      prepare_quote: {
        Args: { p_project_id: string; p_preview_fingerprint: string; p_request_key: string };
        Returns: { result: 'created' | 'reused_prepared' | 'reshare_sent'; quote: Record<string, unknown> };
      };
      get_unsent_estimate_snapshot: {
        Args: { p_project_id: string };
        Returns: { fingerprint: string; content: Record<string, unknown> } | null;
      };
      mark_project_lost: {
        Args: { p_project_id: string };
        Returns: Database['public']['Tables']['projects']['Row'];
      };
      reopen_project: {
        Args: { p_project_id: string };
        Returns: Database['public']['Tables']['projects']['Row'];
      };
      mark_project_won: {
        Args: { p_project_id: string; p_quote_id: string };
        Returns: Database['public']['Tables']['projects']['Row'];
      };
    };
    Enums: {
      lead_source: 'Referral' | 'Google' | 'Phone' | 'Email' | 'Other';
      lead_contact_stage: 'new' | 'contacted' | 'site_visit_completed';
      project_status: 'draft' | 'quote_sent' | 'won' | 'lost';
    };
    CompositeTypes: { [_ in never]: never };
  };
};
