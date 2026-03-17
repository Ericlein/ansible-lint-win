export interface ModuleOption {
  description: string;
  type: string;
  required: boolean;
  choices?: string[] | null;
  default?: any;
  aliases?: string[] | null;
}

export interface ModuleDefinition {
  fqcn: string;
  short_description: string;
  description: string;
  options: Record<string, ModuleOption>;
  deprecated: string | null;
}

export interface KeywordDefinition {
  description: string;
  type: string;
  required: boolean;
}
