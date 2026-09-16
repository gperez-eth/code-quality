/**
 * Generated from the live schema — do not edit by hand.
 *
 * Regenerate after a migration that changes the SHAPE of the schema — a new
 * column, a new table, a new enum value. A migration that only replaces a
 * function body leaves this file correct.
 *
 * In this repository that means the Supabase MCP server:
 *   mcp__supabase__generate_typescript_types, project cmdawpffhylpjbfexnus
 *
 * The CLI form works too, if you have it installed and the project linked:
 *   npx supabase gen types typescript --project-id cmdawpffhylpjbfexnus
 *
 * This is the source of every DTO on the client: `Tables<'issues'>` is exactly
 * a row of `public.issues`, so a column that changes shape breaks the build
 * rather than the page.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      analysis_jobs: {
        Row: {
          analysis_id: string | null;
          attempts: number;
          branch: string | null;
          created_at: string;
          error: string | null;
          finished_at: string | null;
          id: string;
          local_path: string | null;
          organization_id: string;
          project_key: string | null;
          project_name: string | null;
          provider: Database['public']['Enums']['repository_provider'];
          repository_url: string | null;
          requested_by: string | null;
          started_at: string | null;
          status: Database['public']['Enums']['analysis_job_status'];
          trigger: Database['public']['Enums']['analysis_trigger'];
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'analysis_jobs_organization_id_organizations_id_fk';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      analyses: {
        Row: {
          baseline_analysis_id: string | null;
          branch: string;
          commit_author: string | null;
          commit_message: string | null;
          commit_sha: string | null;
          committed_at: string | null;
          error: string | null;
          finished_at: string | null;
          gate_status: Database['public']['Enums']['gate_status'] | null;
          id: string;
          project_id: string;
          started_at: string;
          status: Database['public']['Enums']['analysis_status'];
          trigger: Database['public']['Enums']['analysis_trigger'];
          version: string | null;
        };
        Insert: {
          baseline_analysis_id?: string | null;
          branch?: string;
          commit_author?: string | null;
          commit_message?: string | null;
          commit_sha?: string | null;
          committed_at?: string | null;
          error?: string | null;
          finished_at?: string | null;
          gate_status?: Database['public']['Enums']['gate_status'] | null;
          id?: string;
          project_id: string;
          started_at?: string;
          status?: Database['public']['Enums']['analysis_status'];
          trigger?: Database['public']['Enums']['analysis_trigger'];
          version?: string | null;
        };
        Update: {
          baseline_analysis_id?: string | null;
          branch?: string;
          commit_author?: string | null;
          commit_message?: string | null;
          commit_sha?: string | null;
          committed_at?: string | null;
          error?: string | null;
          finished_at?: string | null;
          gate_status?: Database['public']['Enums']['gate_status'] | null;
          id?: string;
          project_id?: string;
          started_at?: string;
          status?: Database['public']['Enums']['analysis_status'];
          trigger?: Database['public']['Enums']['analysis_trigger'];
          version?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'analyses_project_id_projects_id_fk';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      file_measures: {
        Row: {
          analysis_id: string;
          complexity: number;
          coverage: number | null;
          duplicated_lines_density: number | null;
          effort_minutes: number;
          file_path: string;
          issue_count: number;
          language: string;
          ncloc: number;
        };
        Insert: {
          analysis_id: string;
          complexity?: number;
          coverage?: number | null;
          duplicated_lines_density?: number | null;
          effort_minutes?: number;
          file_path: string;
          issue_count?: number;
          language: string;
          ncloc?: number;
        };
        Update: {
          analysis_id?: string;
          complexity?: number;
          coverage?: number | null;
          duplicated_lines_density?: number | null;
          effort_minutes?: number;
          file_path?: string;
          issue_count?: number;
          language?: string;
          ncloc?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'file_measures_analysis_id_analyses_id_fk';
            columns: ['analysis_id'];
            isOneToOne: false;
            referencedRelation: 'analyses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_measures_analysis_id_analyses_id_fk';
            columns: ['analysis_id'];
            isOneToOne: false;
            referencedRelation: 'project_latest_analysis';
            referencedColumns: ['analysis_id'];
          },
        ];
      };
      issues: {
        Row: {
          analysis_id: string;
          assignee: string | null;
          created_at: string;
          effort_minutes: number;
          end_column: number | null;
          end_line: number;
          file_path: string;
          fingerprint: string;
          flow: Json | null;
          id: string;
          is_new_code: boolean;
          message: string;
          project_id: string;
          resolution: Database['public']['Enums']['resolution'] | null;
          resolved_at: string | null;
          rule_key: string;
          severity: Database['public']['Enums']['severity'];
          start_column: number | null;
          start_line: number;
          status: Database['public']['Enums']['issue_status'];
          tags: string[];
          type: Database['public']['Enums']['issue_type'];
        };
        Insert: {
          analysis_id: string;
          assignee?: string | null;
          created_at?: string;
          effort_minutes?: number;
          end_column?: number | null;
          end_line: number;
          file_path: string;
          fingerprint: string;
          flow?: Json | null;
          id?: string;
          is_new_code?: boolean;
          message: string;
          project_id: string;
          resolution?: Database['public']['Enums']['resolution'] | null;
          resolved_at?: string | null;
          rule_key: string;
          severity: Database['public']['Enums']['severity'];
          start_column?: number | null;
          start_line: number;
          status?: Database['public']['Enums']['issue_status'];
          tags?: string[];
          type: Database['public']['Enums']['issue_type'];
        };
        Update: {
          analysis_id?: string;
          assignee?: string | null;
          created_at?: string;
          effort_minutes?: number;
          end_column?: number | null;
          end_line?: number;
          file_path?: string;
          fingerprint?: string;
          flow?: Json | null;
          id?: string;
          is_new_code?: boolean;
          message?: string;
          project_id?: string;
          resolution?: Database['public']['Enums']['resolution'] | null;
          resolved_at?: string | null;
          rule_key?: string;
          severity?: Database['public']['Enums']['severity'];
          start_column?: number | null;
          start_line?: number;
          status?: Database['public']['Enums']['issue_status'];
          tags?: string[];
          type?: Database['public']['Enums']['issue_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'issues_analysis_id_analyses_id_fk';
            columns: ['analysis_id'];
            isOneToOne: false;
            referencedRelation: 'analyses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_analysis_id_analyses_id_fk';
            columns: ['analysis_id'];
            isOneToOne: false;
            referencedRelation: 'project_latest_analysis';
            referencedColumns: ['analysis_id'];
          },
          {
            foreignKeyName: 'issues_project_id_projects_id_fk';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'issues_rule_key_rules_key_fk';
            columns: ['rule_key'];
            isOneToOne: false;
            referencedRelation: 'rules';
            referencedColumns: ['key'];
          },
        ];
      };
      measures: {
        Row: { analysis_id: string; metric: string; new_code_value: number | null; value: number };
        Insert: { analysis_id: string; metric: string; new_code_value?: number | null; value: number };
        Update: { analysis_id?: string; metric?: string; new_code_value?: number | null; value?: number };
        Relationships: [
          {
            foreignKeyName: 'measures_analysis_id_analyses_id_fk';
            columns: ['analysis_id'];
            isOneToOne: false;
            referencedRelation: 'analyses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'measures_analysis_id_analyses_id_fk';
            columns: ['analysis_id'];
            isOneToOne: false;
            referencedRelation: 'project_latest_analysis';
            referencedColumns: ['analysis_id'];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          organization_id: string;
          role: Database['public']['Enums']['org_role'];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          organization_id: string;
          role?: Database['public']['Enums']['org_role'];
          user_id: string;
        };
        Update: {
          created_at?: string;
          organization_id?: string;
          role?: Database['public']['Enums']['org_role'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_members_organization_id_organizations_id_fk';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: { created_at: string; id: string; name: string; slug: string };
        Insert: { created_at?: string; id?: string; name: string; slug: string };
        Update: { created_at?: string; id?: string; name?: string; slug?: string };
        Relationships: [];
      };
      github_installations: {
        Row: {
          account_login: string;
          account_type: string | null;
          id: number;
          installed_at: string;
          organization_id: string;
          suspended_at: string | null;
        };
        Insert: {
          account_login: string;
          account_type?: string | null;
          id: number;
          installed_at?: string;
          organization_id: string;
          suspended_at?: string | null;
        };
        Update: {
          account_login?: string;
          account_type?: string | null;
          id?: number;
          installed_at?: string;
          organization_id?: string;
          suspended_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'github_installations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      project_branches: {
        Row: {
          first_seen_at: string;
          is_default: boolean;
          last_seen_at: string;
          name: string;
          project_id: string;
        };
        Insert: {
          first_seen_at?: string;
          is_default?: boolean;
          last_seen_at?: string;
          name: string;
          project_id: string;
        };
        Update: {
          first_seen_at?: string;
          is_default?: boolean;
          last_seen_at?: string;
          name?: string;
          project_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_branches_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      projects: {
        Row: {
          access_token_id: string | null;
          analyze_branch_patterns: string[];
          analyze_on_new_branch: boolean;
          analyze_on_push: boolean;
          created_at: string;
          id: string;
          key: string;
          last_analyzed_at: string | null;
          local_path: string | null;
          main_branch: string;
          name: string;
          organization_id: string;
          provider: Database['public']['Enums']['repository_provider'];
          quality_gate_id: string | null;
          repository_url: string | null;
          webhook_secret: string | null;
        };
        Insert: {
          access_token_id?: string | null;
          analyze_branch_patterns?: string[];
          analyze_on_new_branch?: boolean;
          analyze_on_push?: boolean;
          created_at?: string;
          id?: string;
          key: string;
          last_analyzed_at?: string | null;
          local_path?: string | null;
          main_branch?: string;
          name: string;
          organization_id: string;
          provider?: Database['public']['Enums']['repository_provider'];
          quality_gate_id?: string | null;
          repository_url?: string | null;
          webhook_secret?: string | null;
        };
        Update: {
          access_token_id?: string | null;
          analyze_branch_patterns?: string[];
          analyze_on_new_branch?: boolean;
          analyze_on_push?: boolean;
          created_at?: string;
          id?: string;
          key?: string;
          last_analyzed_at?: string | null;
          local_path?: string | null;
          main_branch?: string;
          name?: string;
          organization_id?: string;
          provider?: Database['public']['Enums']['repository_provider'];
          quality_gate_id?: string | null;
          repository_url?: string | null;
          webhook_secret?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_organization_id_organizations_id_fk';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'projects_quality_gate_id_quality_gates_id_fk';
            columns: ['quality_gate_id'];
            isOneToOne: false;
            referencedRelation: 'quality_gates';
            referencedColumns: ['id'];
          },
        ];
      };
      quality_gate_conditions: {
        Row: {
          gate_id: string;
          id: string;
          metric: string;
          operator: Database['public']['Enums']['gate_operator'];
          scope: Database['public']['Enums']['gate_scope'];
          threshold: number;
        };
        Insert: {
          gate_id: string;
          id?: string;
          metric: string;
          operator: Database['public']['Enums']['gate_operator'];
          scope?: Database['public']['Enums']['gate_scope'];
          threshold: number;
        };
        Update: {
          gate_id?: string;
          id?: string;
          metric?: string;
          operator?: Database['public']['Enums']['gate_operator'];
          scope?: Database['public']['Enums']['gate_scope'];
          threshold?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'quality_gate_conditions_gate_id_quality_gates_id_fk';
            columns: ['gate_id'];
            isOneToOne: false;
            referencedRelation: 'quality_gates';
            referencedColumns: ['id'];
          },
        ];
      };
      quality_gates: {
        Row: {
          created_at: string;
          id: string;
          is_built_in: boolean;
          is_default: boolean;
          name: string;
          organization_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_built_in?: boolean;
          is_default?: boolean;
          name: string;
          organization_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_built_in?: boolean;
          is_default?: boolean;
          name?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quality_gates_organization_id_organizations_id_fk';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      rules: {
        Row: {
          default_severity: Database['public']['Enums']['severity'];
          description: string;
          effort_minutes: number;
          is_active: boolean;
          key: string;
          languages: string[];
          name: string;
          tags: string[];
          type: Database['public']['Enums']['issue_type'];
        };
        Insert: {
          default_severity: Database['public']['Enums']['severity'];
          description?: string;
          effort_minutes?: number;
          is_active?: boolean;
          key: string;
          languages?: string[];
          name: string;
          tags?: string[];
          type: Database['public']['Enums']['issue_type'];
        };
        Update: {
          default_severity?: Database['public']['Enums']['severity'];
          description?: string;
          effort_minutes?: number;
          is_active?: boolean;
          key?: string;
          languages?: string[];
          name?: string;
          tags?: string[];
          type?: Database['public']['Enums']['issue_type'];
        };
        Relationships: [];
      };
    };
    Views: {
      analysis_language_ncloc: {
        Row: { analysis_id: string | null; language: string | null; ncloc: number | null };
        Relationships: [
          {
            foreignKeyName: 'file_measures_analysis_id_analyses_id_fk';
            columns: ['analysis_id'];
            isOneToOne: false;
            referencedRelation: 'analyses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_measures_analysis_id_analyses_id_fk';
            columns: ['analysis_id'];
            isOneToOne: false;
            referencedRelation: 'project_latest_analysis';
            referencedColumns: ['analysis_id'];
          },
        ];
      };
      project_branch_latest_analysis: {
        Row: {
          analysis_id: string | null;
          baseline_analysis_id: string | null;
          branch: string | null;
          commit_author: string | null;
          commit_message: string | null;
          commit_sha: string | null;
          error: string | null;
          finished_at: string | null;
          gate_status: Database['public']['Enums']['gate_status'] | null;
          project_id: string | null;
          started_at: string | null;
          status: Database['public']['Enums']['analysis_status'] | null;
          version: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'analyses_project_id_projects_id_fk';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      project_latest_analysis: {
        Row: {
          analysis_id: string | null;
          baseline_analysis_id: string | null;
          branch: string | null;
          commit_author: string | null;
          commit_message: string | null;
          commit_sha: string | null;
          error: string | null;
          finished_at: string | null;
          gate_status: Database['public']['Enums']['gate_status'] | null;
          project_id: string | null;
          started_at: string | null;
          status: Database['public']['Enums']['analysis_status'] | null;
          version: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'analyses_project_id_projects_id_fk';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      project_open_issue_counts: {
        Row: { open_effort_minutes: number | null; open_issues: number | null; project_id: string | null };
        Relationships: [
          {
            foreignKeyName: 'issues_project_id_projects_id_fk';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      import_analysis: {
        Args: {
          p_organization_id: string;
          p_project_key: string;
          p_report: Json;
          p_default_gate: Json;
          p_project_name?: string;
          p_provider?: string;
          p_repository_url?: string;
          p_local_path?: string;
          p_access_token_id?: string;
          p_branch?: string;
          p_commit_sha?: string;
          p_commit_message?: string;
          p_commit_author?: string;
          p_committed_at?: string;
          p_trigger?: string;
          p_version?: string;
        };
        Returns: Json;
      };
      request_analysis: {
        Args: {
          p_organization_id: string;
          p_provider?: string;
          p_repository_url?: string;
          p_local_path?: string;
          p_project_key?: string;
          p_project_name?: string;
          p_branch?: string;
          p_trigger?: string;
          /** Plaintext, over TLS, straight into the vault. Never stored as given. */
          p_access_token?: string;
        };
        Returns: string;
      };
      issue_facets: {
        Args: {
          p_file?: string;
          p_new_code_only?: boolean;
          p_project_id: string;
          p_severities?: string[];
          p_statuses?: string[];
          p_tags?: string[];
          p_types?: string[];
        };
        Returns: Json;
      };
      begin_github_install: {
        Args: {
          p_organization_id: string;
        };
        /** The `state` to hand GitHub, and to recognise on the way back. */
        Returns: string;
      };
      claim_github_install: {
        Args: {
          p_nonce: string;
          p_installation_id: number;
        };
        /** The organisation the installation now belongs to. Raises otherwise. */
        Returns: string;
      };
      set_analysis_automation: {
        Args: {
          p_project_id: string;
          p_analyze_on_push: boolean;
          p_branch_patterns: string[];
          p_analyze_on_new_branch: boolean;
        };
        Returns: undefined;
      };
      matching_branches: {
        Args: {
          p_project_id: string;
          p_patterns: string[];
        };
        /**
         * The branches those patterns catch today. Evaluated by the same
         * `branch_matches` the webhook uses, so the preview cannot disagree
         * with what actually gets queued.
         */
        Returns: string[];
      };
    };
    Enums: {
      analysis_job_status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
      analysis_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
      analysis_trigger: 'MANUAL' | 'PUSH' | 'SCHEDULE' | 'CLI';
      gate_operator: 'GT' | 'LT' | 'WORSE_THAN';
      gate_scope: 'OVERALL' | 'NEW_CODE';
      gate_status: 'PASSED' | 'FAILED';
      issue_status: 'OPEN' | 'CONFIRMED' | 'REOPENED' | 'RESOLVED' | 'CLOSED';
      issue_type: 'BUG' | 'VULNERABILITY' | 'CODE_SMELL' | 'SECURITY_HOTSPOT';
      org_role: 'OWNER' | 'ADMIN' | 'MEMBER';
      repository_provider: 'GITHUB' | 'GITLAB' | 'OTHER';
      resolution: 'FIXED' | 'FALSE_POSITIVE' | 'WONT_FIX' | 'REMOVED';
      severity: 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

/** Everything selectable: real tables and the read-model views alike. */
type Relations = DefaultSchema['Tables'] & DefaultSchema['Views'];

/** A row as it comes back from a select: `Tables<'projects'>`. */
export type Tables<Name extends keyof Relations> = Relations[Name]['Row'];

/** The shape an insert accepts, with defaulted columns optional. */
export type TablesInsert<Name extends keyof DefaultSchema['Tables']> = DefaultSchema['Tables'][Name]['Insert'];

/** The shape an update accepts: every column optional. */
export type TablesUpdate<Name extends keyof DefaultSchema['Tables']> = DefaultSchema['Tables'][Name]['Update'];

/** A database enum as a union: `Enums<'severity'>`. */
export type Enums<Name extends keyof DefaultSchema['Enums']> = DefaultSchema['Enums'][Name];

export const Constants = {
  public: {
    Enums: {
      analysis_job_status: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'],
      analysis_status: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'],
      analysis_trigger: ['MANUAL', 'PUSH', 'SCHEDULE', 'CLI'],
      gate_operator: ['GT', 'LT', 'WORSE_THAN'],
      gate_scope: ['OVERALL', 'NEW_CODE'],
      gate_status: ['PASSED', 'FAILED'],
      issue_status: ['OPEN', 'CONFIRMED', 'REOPENED', 'RESOLVED', 'CLOSED'],
      issue_type: ['BUG', 'VULNERABILITY', 'CODE_SMELL', 'SECURITY_HOTSPOT'],
      org_role: ['OWNER', 'ADMIN', 'MEMBER'],
      repository_provider: ['GITHUB', 'GITLAB', 'OTHER'],
      resolution: ['FIXED', 'FALSE_POSITIVE', 'WONT_FIX', 'REMOVED'],
      severity: ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'],
    },
  },
} as const;
