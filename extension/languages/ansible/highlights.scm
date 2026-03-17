; Ansible-specific highlights on top of YAML tree-sitter grammar

(block_mapping_pair
  key: (flow_node) @keyword
  (#match? @keyword "^(hosts|become|become_user|gather_facts|tasks|pre_tasks|post_tasks|handlers|roles|vars|vars_files|name|register|when|loop|notify|tags|block|rescue|always|include_tasks|import_tasks|include_role|import_role|environment|serial|strategy|connection|delegate_to|run_once|changed_when|failed_when|ignore_errors|no_log|check_mode|async|poll|retries|delay|until)$"))

(block_mapping_pair
  key: (flow_node) @module
  (#match? @module "^[a-z_]+\\.[a-z_]+\\.[a-z_]+$"))

(flow_node
  (plain_scalar) @string.special
  (#match? @string.special "^\\{\\{.*\\}\\}$"))

(comment) @comment
(block_scalar) @string
(double_quote_scalar) @string
(single_quote_scalar) @string
(boolean_scalar) @constant.builtin
(null_scalar) @constant.builtin
(integer_scalar) @number
(float_scalar) @number
