import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  Hover,
  Definition,
  Diagnostic,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'path';
import { loadData } from './data/loader';
import { getCompletions } from './providers/completion';
import { getHover } from './providers/hover';
import { getDefinition } from './providers/definition';
import { runDiagnostics } from './providers/diagnostics';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceRoot = '';

connection.onInitialize((params) => {
  workspaceRoot = params.rootUri
    ? params.rootUri.replace('file:///', '').replace('file://', '')
    : params.rootPath || '';

  // Load module data
  const dataDir = path.resolve(__dirname, '..', 'data');
  try {
    loadData(dataDir);
    connection.console.log('Module data loaded successfully');
  } catch (e) {
    connection.console.error(`Failed to load data: ${e}`);
  }

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['.', ':', ' ', '-'],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
    },
  };
  return result;
});

connection.onInitialized(() => {
  connection.console.log('ansible-ls-lite initialized');
});

// Completions
connection.onCompletion((params): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return getCompletions(doc, params.position);
});

// Hover
connection.onHover((params): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  return getHover(doc, params.position);
});

// Go-to-definition
connection.onDefinition((params): Definition | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  return getDefinition(doc, params.position, workspaceRoot);
});

// Diagnostics on document change (debounced)
const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();

documents.onDidChangeContent((change) => {
  const uri = change.document.uri;
  const existing = diagnosticTimers.get(uri);
  if (existing) clearTimeout(existing);

  diagnosticTimers.set(uri, setTimeout(() => {
    diagnosticTimers.delete(uri);
    const diagnostics = runDiagnostics(change.document);
    connection.sendDiagnostics({ uri, diagnostics });
  }, 300));
});

documents.onDidClose((e) => {
  const timer = diagnosticTimers.get(e.document.uri);
  if (timer) clearTimeout(timer);
  diagnosticTimers.delete(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
