# Product Requirements Document: Ben10 Context Persistence

**Product Name:** Ben10 (named after Ben Tennyson's photographic memory)
**Version:** 1.0
**Author:** Product Management
**Date:** January 2026
**Status:** Draft

---

## Executive Summary

Ben10—named after the cartoon hero Ben Tennyson, famous for his photographic memory—is a utility that automatically persists and restores the Claude Code context window state when sessions exit or start within a specific working directory. This enables developers to maintain conversational continuity across sessions, preserving the rich context that Claude Code accumulates during extended development work—including file references, architectural decisions, debugging history, and project-specific knowledge.

The tool addresses a critical pain point: when a Claude Code session ends (intentionally or due to crashes, timeouts, or system restarts), all accumulated context is lost, forcing developers to re-establish context from scratch. Ben10 eliminates this friction by treating context as a first-class, persistent asset tied to project directories.

---

## Problem Statement

### Current State Pain Points

1. **Context Loss on Session Termination:** Claude Code sessions accumulate valuable context over time—understanding of codebase architecture, debugging history, design decisions, and task progress. When sessions end, this context evaporates entirely.

2. **Repetitive Context Re-establishment:** Developers spend 5-15 minutes at the start of each session re-explaining project structure, conventions, and current objectives. For complex projects, this overhead compounds significantly.

3. **Interrupted Workflow Continuity:** System crashes, network interruptions, or accidental terminal closures force complete context rebuilding, breaking developer flow state.

4. **Multi-Project Context Switching:** Developers working across multiple projects cannot quickly resume context-appropriate sessions when switching between repositories.

5. **Team Knowledge Silos:** Valuable context about architectural decisions and project-specific patterns remains trapped in individual sessions rather than being shareable across team members.

### Impact Quantification

| Metric | Current State | Estimated Impact |
|--------|---------------|------------------|
| Time to productive session | 5-15 minutes | 80% reduction |
| Context rebuilding frequency | Every session | Only on major changes |
| Lost debugging context | 100% on exit | 0% with auto-persist |
| Cross-session task continuity | Manual notes required | Automatic |

---

## Target Users

### Primary Personas

**1. Professional Software Engineers**
- Work on complex, long-running projects
- Use Claude Code as primary AI coding assistant
- Value workflow continuity and minimal friction
- Comfortable with CLI tools and configuration

**2. Technical Leads / Architects**
- Need to maintain context about system-wide design decisions
- Switch between multiple projects frequently
- May share context snapshots with team members for onboarding

**3. Open Source Maintainers**
- Return to projects intermittently
- Need rapid context restoration after periods away
- Value project-specific memory of contribution guidelines and patterns

### Secondary Personas

**4. DevOps / Platform Engineers**
- Work across many repositories with distinct contexts
- Need infrastructure-specific context (deployment patterns, incident history)

**5. Students / Learners**
- Building understanding over time
- Benefit from preserved learning context and explanations

---

## Product Goals & Success Metrics

### Goals

| Priority | Goal | Description |
|----------|------|-------------|
| P0 | Seamless Persistence | Context saves automatically on session exit with zero user intervention |
| P0 | Reliable Restoration | Context restores accurately on session start in persisted directories |
| P1 | Directory Scoping | Each project directory maintains independent context state |
| P1 | Minimal Overhead | Persistence operations complete in <500ms, no perceptible latency |
| P2 | Manual Controls | CLI commands for explicit save/restore/clear operations |
| P2 | Context Inspection | Ability to view and understand persisted context contents |
| P3 | Team Sharing | Export/import context snapshots for team collaboration |

### Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Auto-save success rate | >99.5% | Telemetry on save operations |
| Restore accuracy | >98% functional equivalence | Automated comparison tests |
| Time to first productive prompt | <30 seconds | Session timing analysis |
| User retention (30-day) | >80% of installers | Usage telemetry |
| Context storage efficiency | <10MB per typical project | Storage audits |
| Performance overhead | <100ms added latency | Benchmark suite |

---

## Functional Requirements

### FR-1: Automatic Context Persistence

**FR-1.1: Exit Detection**
- Detect all session termination scenarios:
  - Normal exit (user types `/exit` or `quit`)
  - SIGINT (Ctrl+C)
  - SIGTERM (system shutdown)
  - SIGHUP (terminal hangup)
  - Crash recovery (via periodic checkpointing)
- Register signal handlers during session initialization
- Implement graceful degradation if signal handling fails

**FR-1.2: Context Serialization**
- Serialize the following context components:
  - Conversation history (messages, roles, timestamps)
  - File reference registry (paths, last-known hashes, access patterns)
  - Tool execution history (commands run, outputs, success/failure)
  - Active task state (current objectives, progress markers)
  - User corrections and preferences expressed in session
  - Model-generated summaries and mental models
- Use efficient binary serialization (MessagePack or similar)
- Implement incremental serialization for large contexts

**FR-1.3: Checkpointing**
- Create periodic checkpoints every N messages (configurable, default: 10)
- Checkpoint on significant events (file modifications, tool completions)
- Maintain rolling checkpoint history (last 3 checkpoints)
- Enable crash recovery from most recent valid checkpoint

### FR-2: Context Restoration

**FR-2.1: Directory Detection**
- On Claude Code startup, check for existing context in working directory
- Support explicit directory specification via `--context-dir` flag
- Handle directory moves/renames via content-addressable fallback

**FR-2.2: Context Deserialization**
- Restore full context state from persisted format
- Validate context integrity via checksums before restoration
- Handle schema migrations for older context formats
- Provide clear error messages for corrupted/incompatible contexts

**FR-2.3: Restoration Modes**
- **Full Restore (default):** Load complete context, resume as if session never ended
- **Summary Restore:** Load compressed summary, reducing token usage
- **Selective Restore:** Interactive prompt to choose context components
- **Fresh Start:** Explicit opt-out, ignore persisted context

**FR-2.4: Context Reconciliation**
- Detect file system changes since last session
- Flag modified/deleted/new files to user
- Offer to update context with current file states
- Handle merge conflicts between persisted and current state

### FR-3: Directory-Scoped Storage

**FR-3.1: Storage Location**
- Primary: `.claude/context/` within project directory
- Fallback: `~/.claude-code/contexts/<directory-hash>/` for read-only directories
- Respect `.gitignore` patterns (context directory excluded by default)

**FR-3.2: Storage Structure**
```
.claude/
├── context/
│   ├── current.ctx          # Active context (binary)
│   ├── current.ctx.meta     # Metadata (JSON)
│   ├── checkpoints/
│   │   ├── cp-001.ctx
│   │   ├── cp-002.ctx
│   │   └── cp-003.ctx
│   ├── history/
│   │   └── session-<timestamp>.ctx.gz
│   ├── compaction-snapshots/
│   │   ├── index.json       # Snapshot metadata index
│   │   ├── pre-compact-20260127-143022-a1b2c3.ctx.zst
│   │   ├── pre-compact-20260125-091547-d4e5f6.ctx.zst
│   │   └── .pinned          # List of pinned snapshot IDs
│   └── exports/
│       └── <export-name>.ctxpkg
└── config.yaml              # Project-specific Ben10 settings
```

**FR-3.3: Storage Management**
- Automatic cleanup of checkpoints older than 7 days
- Configurable history retention (default: 5 sessions)
- Storage size warnings at 50MB, hard limit at 100MB (configurable)
- Compression for archived sessions (gzip)

### FR-4: Manual Controls (CLI)

**FR-4.1: Save Commands**
```bash
claude context save                    # Explicit save to default location
claude context save --name "pre-refactor"  # Named snapshot
claude context save --export ./backup.ctxpkg  # Portable export
```

**FR-4.2: Restore Commands**
```bash
claude context restore                 # Restore from default location
claude context restore --name "pre-refactor"  # Restore named snapshot
claude context restore --from ./backup.ctxpkg  # Import from export
claude context restore --checkpoint 2  # Restore specific checkpoint
```

**FR-4.3: Inspection Commands**
```bash
claude context status                  # Show current context state
claude context list                    # List available contexts/snapshots
claude context diff                    # Show changes since last persist
claude context inspect                 # Detailed context breakdown
claude context inspect --messages      # View conversation history
claude context inspect --files         # View tracked file registry
```

**FR-4.4: Management Commands**
```bash
claude context clear                   # Clear current context (with confirmation)
claude context clear --force           # Skip confirmation
claude context prune                   # Clean up old checkpoints/history
claude context config                  # View/edit context settings
```

**FR-4.5: Compaction Snapshot Commands**
```bash
# Listing and inspection
claude context compaction list                    # List all compaction snapshots
claude context compaction list --verbose          # Include token counts and summaries
claude context compaction show <snapshot-id>      # View snapshot metadata
claude context compaction diff <snapshot-id>      # Compare snapshot vs current state

# Restoration
claude context compaction restore <snapshot-id>   # Restore full pre-compaction state
claude context compaction restore <snapshot-id> --partial  # Interactive partial restore
claude context compaction extract <snapshot-id> --messages  # Extract just conversation
claude context compaction extract <snapshot-id> --files     # Extract just file states

# Management
claude context compaction pin <snapshot-id>       # Protect snapshot from auto-pruning
claude context compaction unpin <snapshot-id>     # Remove pin protection
claude context compaction delete <snapshot-id>    # Manually delete a snapshot
claude context compaction prune                   # Apply retention policy now
claude context compaction export <snapshot-id> ./backup.ctx  # Export snapshot

# Manual trigger
claude context compaction snapshot                # Force snapshot of current state
                                                  # (without triggering compaction)
```

### FR-5: Configuration

**FR-5.1: Configuration Hierarchy**
1. Command-line flags (highest priority)
2. Project config (`.claude/config.yaml`)
3. User config (`~/.claude-code/config.yaml`)
4. System defaults (lowest priority)

**FR-5.2: Configuration Options**
```yaml
context:
  # Persistence behavior
  auto_save: true                    # Enable automatic persistence
  auto_restore: true                 # Enable automatic restoration
  checkpoint_interval: 10            # Messages between checkpoints
  
  # Storage settings
  storage_location: ".claude/context"
  max_storage_mb: 100
  history_retention_count: 5
  checkpoint_retention_days: 7
  
  # Pre-compaction snapshot settings
  compaction_snapshots:
    enabled: true                    # Save context before each compaction
    retention_count: 5               # Keep N most recent snapshots
    retention_days: 30               # Delete snapshots older than N days
    max_storage_mb: 500              # Total storage limit for snapshots
    compression_level: 19            # ZSTD compression (1-22, higher=smaller)
    include_file_contents: true      # Include full file contents (not just refs)
    notify_on_snapshot: true         # Show notification when snapshot created
  
  # Restoration settings
  default_restore_mode: "full"       # full | summary | selective
  reconcile_on_restore: true         # Check for file changes
  
  # Content filtering
  exclude_patterns:                  # Don't track these in context
    - "*.log"
    - "node_modules/**"
    - ".env*"
  sensitive_redaction: true          # Redact detected secrets
  
  # Performance
  compression: true
  lazy_restore: false                # Load context components on-demand
```

### FR-7: Pre-Compaction Snapshots

**FR-7.1: Compaction Event Detection**
- Hook into Claude Code's context compaction trigger
- Detect when token count approaches compaction threshold
- Intercept compaction event before summarization occurs
- Support both automatic and manual compaction scenarios

**FR-7.2: Snapshot Creation**
- Capture complete, uncompacted context state immediately before compaction
- Include full conversation history with all message detail
- Preserve complete tool execution outputs (often truncated in compaction)
- Retain full file contents that were in context (not just references)
- Tag snapshot with compaction metadata:
  - Pre-compaction token count
  - Compaction trigger reason (threshold, manual, memory pressure)
  - Timestamp and session identifier
  - Summary of what will be lost/compressed

**FR-7.3: Snapshot Storage**
- Store in dedicated compaction archive: `.claude/context/compaction-snapshots/`
- Naming convention: `pre-compact-<timestamp>-<session-id>.ctx`
- Apply aggressive compression (ZSTD level 19) for archival efficiency
- Maintain index file for quick lookup without loading full snapshots

**FR-7.4: Retention Policy**
- Configurable retention count (default: 5 most recent compaction snapshots)
- Configurable retention period (default: 30 days)
- Size-based limits (default: 500MB total for compaction archive)
- Automatic pruning of oldest snapshots when limits exceeded
- Option to mark specific snapshots as "pinned" (exempt from auto-pruning)

**FR-7.5: Snapshot Restoration**
- Restore full pre-compaction state on demand
- Warning: Restoration replaces current context entirely
- Support partial restoration (extract specific conversations or file states)
- Diff view: Compare current compacted state vs. pre-compaction snapshot

**FR-7.6: Snapshot Inspection**
- List all available compaction snapshots with metadata
- View token counts and content summaries without full load
- Export individual snapshots for external analysis
- Search across snapshots for specific content

### FR-6: Context Inspection & Transparency

**FR-6.1: Status Display**
- Show context size (tokens, messages, files)
- Display last save timestamp
- Indicate checkpoint health
- Surface any warnings or issues

**FR-6.2: Content Inspection**
- Human-readable export of conversation history
- File registry with modification status
- Tool execution log
- Summary of accumulated knowledge

**FR-6.3: Privacy Controls**
- Redact sensitive information in exports
- Support selective content exclusion
- Clear audit trail of what is persisted

---

## Technical Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claude Code Process                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Session    │  │   Context    │  │    Signal/Exit       │  │
│  │   Manager    │◄─┤   Engine     │◄─┤    Handler           │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘  │
│         │                 │                                     │
│         ▼                 ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  Context State Store                      │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐            │  │
│  │  │ Messages   │ │ File       │ │ Tool       │            │  │
│  │  │ Buffer     │ │ Registry   │ │ History    │  ...       │  │
│  │  └────────────┘ └────────────┘ └────────────┘            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               Persistence Layer                           │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐            │  │
│  │  │ Serializer │ │ Compressor │ │ Encryptor  │            │  │
│  │  │ (MsgPack)  │ │ (LZ4)      │ │ (Optional) │            │  │
│  │  └────────────┘ └────────────┘ └────────────┘            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     File System                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  .claude/context/                                        │   │
│  │    ├── current.ctx                                       │   │
│  │    ├── checkpoints/                                      │   │
│  │    └── history/                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Context State Model

```
┌─────────────────────────────────────────────────────────────┐
│                    ContextState                             │
├─────────────────────────────────────────────────────────────┤
│  version: string           # Schema version                 │
│  created_at: timestamp     # Initial creation time          │
│  updated_at: timestamp     # Last modification time         │
│  session_count: int        # Number of sessions using this  │
│  directory_path: string    # Canonical directory path       │
│  directory_hash: string    # Content-addressable identifier │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ConversationHistory                                 │   │
│  │  ├── messages: Message[]                            │   │
│  │  ├── total_tokens: int                              │   │
│  │  └── summary: string (compressed representation)    │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  FileRegistry                                        │   │
│  │  ├── tracked_files: Map<path, FileMetadata>         │   │
│  │  ├── access_patterns: AccessPattern[]               │   │
│  │  └── change_detection: ChangeLog[]                  │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ToolExecutionHistory                                │   │
│  │  ├── executions: ToolExecution[]                    │   │
│  │  ├── success_rate: float                            │   │
│  │  └── common_patterns: Pattern[]                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  TaskState                                           │   │
│  │  ├── active_objectives: Objective[]                 │   │
│  │  ├── completed_tasks: Task[]                        │   │
│  │  └── pending_items: Item[]                          │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  LearnedPreferences                                  │   │
│  │  ├── coding_style: StylePreferences                 │   │
│  │  ├── communication_style: CommPreferences           │   │
│  │  └── corrections: Correction[]                      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Data Schemas

**Message Schema:**
```typescript
interface Message {
  id: string;                    // Unique identifier
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  token_count: number;
  metadata: {
    tool_calls?: ToolCall[];
    file_references?: string[];
    task_references?: string[];
  };
}
```

**FileMetadata Schema:**
```typescript
interface FileMetadata {
  path: string;                  // Relative to project root
  hash: string;                  // Content hash at last access
  last_accessed: number;
  access_count: number;
  content_summary?: string;      // AI-generated summary
  relevance_score: number;       // 0-1, how central to context
}
```

**ToolExecution Schema:**
```typescript
interface ToolExecution {
  id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
  duration_ms: number;
  timestamp: number;
  related_files: string[];
}
```

**CompactionSnapshot Schema:**
```typescript
interface CompactionSnapshot {
  id: string;                        // Unique identifier (timestamp + session)
  created_at: number;                // Snapshot creation timestamp
  session_id: string;                // Originating session
  
  // Pre-compaction metrics
  pre_compaction: {
    token_count: number;             // Total tokens before compaction
    message_count: number;           // Total messages
    file_count: number;              // Files with content in context
    tool_execution_count: number;    // Tool executions with full output
  };
  
  // Post-compaction metrics (for comparison)
  post_compaction: {
    token_count: number;
    message_count: number;           // Same count, but summarized
  };
  
  // Compaction metadata
  compaction_trigger: "threshold" | "manual" | "memory_pressure";
  compaction_ratio: number;          // Compression ratio achieved
  
  // Content (stored separately in .ctx.zst file)
  content_hash: string;              // SHA-256 of full content
  compressed_size_bytes: number;
  uncompressed_size_bytes: number;
  
  // Management
  pinned: boolean;                   // Exempt from auto-pruning
  tags: string[];                    // User-defined tags
  notes: string;                     // User-defined notes
}

interface CompactionSnapshotIndex {
  version: string;
  snapshots: CompactionSnapshot[];
  total_size_bytes: number;
  last_pruned: number;
}
```

### Persistence Format

**Binary Format (MessagePack):**
- Header: Magic bytes + version + flags + checksum
- Segments: Independently decompressible chunks
- Index: Offset table for lazy loading
- Footer: Integrity verification

```
┌──────────────────────────────────────────────┐
│  Header (32 bytes)                           │
│  ├── Magic: "Ben10" (4 bytes)                │
│  ├── Version: uint16                         │
│  ├── Flags: uint16                           │
│  ├── Segment Count: uint32                   │
│  ├── Total Size: uint64                      │
│  └── Header Checksum: uint64                 │
├──────────────────────────────────────────────┤
│  Segment Index (variable)                    │
│  └── [offset, size, type, checksum][]       │
├──────────────────────────────────────────────┤
│  Segment 0: Metadata                         │
├──────────────────────────────────────────────┤
│  Segment 1: Conversation History             │
├──────────────────────────────────────────────┤
│  Segment 2: File Registry                    │
├──────────────────────────────────────────────┤
│  Segment N: ...                              │
├──────────────────────────────────────────────┤
│  Footer                                      │
│  └── Full Content Checksum: uint64          │
└──────────────────────────────────────────────┘
```

---

## User Experience

### Workflow: Automatic Persistence (Happy Path)

```
Developer                          Ben10                           Storage
    │                                │                                │
    │  Start Claude Code in ./myproj │                                │
    │───────────────────────────────>│                                │
    │                                │  Check for existing context    │
    │                                │───────────────────────────────>│
    │                                │<───────────────────────────────│
    │                                │  Context found, restore        │
    │  "Restored context from        │                                │
    │   yesterday (247 messages,     │                                │
    │   12 files tracked)"           │                                │
    │<───────────────────────────────│                                │
    │                                │                                │
    │  Work for 2 hours...           │                                │
    │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ >│                                │
    │                                │  Periodic checkpoints          │
    │                                │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─>│
    │                                │                                │
    │  Exit session (Ctrl+D)         │                                │
    │───────────────────────────────>│                                │
    │                                │  Serialize full context        │
    │                                │───────────────────────────────>│
    │  "Context saved (523 messages, │                                │
    │   18 files, 4.2MB)"            │                                │
    │<───────────────────────────────│                                │
    │                                │                                │
```

### Workflow: Crash Recovery

```
Developer                          Ben10                           Storage
    │                                │                                │
    │  Working in session...         │                                │
    │───────────────────────────────>│                                │
    │                                │  Checkpoint at message 50      │
    │                                │───────────────────────────────>│
    │                                │                                │
    │  [System crash / OOM kill]     │                                │
    │  ════════════════════════════  │                                │
    │                                │                                │
    │  Restart Claude Code           │                                │
    │───────────────────────────────>│                                │
    │                                │  Check for context             │
    │                                │───────────────────────────────>│
    │                                │  Found checkpoint, not current │
    │                                │<───────────────────────────────│
    │  "Recovered from checkpoint    │                                │
    │   (50 messages). ~3 messages   │                                │
    │   may be lost since last save" │                                │
    │<───────────────────────────────│                                │
    │                                │                                │
```

### Workflow: Multi-Project Context Switching

```
Developer                          Ben10
    │                                │
    │  cd ~/projects/frontend        │
    │  claude                        │
    │───────────────────────────────>│
    │  "Restored: React app context" │
    │<───────────────────────────────│
    │                                │
    │  /exit                         │
    │───────────────────────────────>│
    │  "Context saved"               │
    │<───────────────────────────────│
    │                                │
    │  cd ~/projects/backend         │
    │  claude                        │
    │───────────────────────────────>│
    │  "Restored: API server context"│
    │<───────────────────────────────│
    │                                │
```

### Workflow: Pre-Compaction Snapshot

```
Developer                          Ben10                    Claude Code Engine
    │                                │                                │
    │  Long coding session...        │                                │
    │  Context grows to 180K tokens  │                                │
    │───────────────────────────────>│                                │
    │                                │                                │
    │                                │   Compaction threshold reached │
    │                                │<───────────────────────────────│
    │                                │                                │
    │                                │   Intercept, create snapshot   │
    │                                │──────────┐                     │
    │                                │          │ Save full context   │
    │                                │<─────────┘ (180K tokens)       │
    │                                │                                │
    │  "📸 Pre-compaction snapshot   │                                │
    │   saved (180,241 tokens)"      │                                │
    │<───────────────────────────────│                                │
    │                                │                                │
    │                                │   Allow compaction to proceed  │
    │                                │───────────────────────────────>│
    │                                │                                │
    │                                │   Compaction complete (45K)    │
    │                                │<───────────────────────────────│
    │                                │                                │
    │  Session continues with        │                                │
    │  compacted context...          │                                │
    │                                │                                │
    │  [Later] Need detail from      │                                │
    │  pre-compaction conversation   │                                │
    │                                │                                │
    │  claude context compaction     │                                │
    │        list                    │                                │
    │───────────────────────────────>│                                │
    │                                │                                │
    │  Shows available snapshots     │                                │
    │  with timestamps & token counts│                                │
    │<───────────────────────────────│                                │
    │                                │                                │
```

### CLI Output Examples

**Session Start with Restored Context:**
```
$ cd ~/myproject && claude

╭─────────────────────────────────────────────────────────────╮
│  Context Restored                                           │
├─────────────────────────────────────────────────────────────┤
│  Last session: 2 hours ago (Jan 27, 2026 2:34 PM)          │
│  Messages: 247 (condensed to 12,847 tokens)                │
│  Files tracked: 12                                          │
│  Active task: "Implement user authentication flow"          │
│                                                             │
│  ⚠ 2 tracked files have changed since last session         │
│    Run `claude context diff` for details                    │
╰─────────────────────────────────────────────────────────────╯

Ready to continue. What would you like to work on?
```

**Context Status Command:**
```
$ claude context status

Context Status for ~/myproject
══════════════════════════════════════════════════════════════

State:          Active (restored from disk)
Location:       .claude/context/current.ctx
Size:           4.2 MB (2.1 MB compressed)

Conversation:
  Messages:     523 (user: 198, assistant: 325)
  Tokens:       48,291 (limit: 200,000)
  Duration:     12 sessions over 3 weeks

File Registry:
  Tracked:      18 files
  Modified:     3 since last session
  Deleted:      1 since last session

Checkpoints:
  Latest:       5 minutes ago (cp-003)
  Count:        3 available
  Auto-save:    Every 10 messages

Health:         ✓ Good (no issues detected)
```

**Context Diff Command:**
```
$ claude context diff

Changes since last session (Jan 27, 2026 2:34 PM)
══════════════════════════════════════════════════════════════

Modified Files:
  M  src/auth/login.ts           (+45, -12 lines)
  M  src/api/routes.ts           (+8, -2 lines)
  M  package.json                (dependency update)

Deleted Files:
  D  src/auth/legacy-login.ts    (was tracked)

New Files (untracked):
  ?  src/auth/oauth.ts
  ?  src/auth/oauth.test.ts

Actions:
  [R] Reconcile - Update context with current file states
  [I] Ignore - Keep context as-is, I'll explain changes
  [V] View - Show detailed diff for a file

Choice [R/I/V]:
```

**Compaction Snapshot Notification:**
```
╭─────────────────────────────────────────────────────────────╮
│  📸 Pre-Compaction Snapshot Saved                           │
├─────────────────────────────────────────────────────────────┤
│  Snapshot ID:    pre-compact-20260127-143022-a1b2c3        │
│  Token count:    180,241 (before) → ~45,000 (after)        │
│  Messages:       847 preserved                              │
│  File contents:  23 files captured                          │
│  Size:           12.4 MB (compressed: 3.1 MB)              │
│                                                             │
│  Restore anytime: claude context compaction restore a1b2c3 │
╰─────────────────────────────────────────────────────────────╯
```

**Compaction Snapshot List Command:**
```
$ claude context compaction list --verbose

Compaction Snapshots for ~/myproject
══════════════════════════════════════════════════════════════

ID          Date                 Tokens    Messages  Size    Pinned
──────────────────────────────────────────────────────────────────────
a1b2c3      Jan 27, 2026 2:30p   180,241   847       3.1 MB  
d4e5f6      Jan 25, 2026 9:15a   165,892   723       2.8 MB  📌
g7h8i9      Jan 22, 2026 4:45p   171,034   789       2.9 MB  
j0k1l2      Jan 18, 2026 11:20a  158,445   698       2.6 MB  
m3n4o5      Jan 15, 2026 3:00p   162,118   712       2.7 MB  

Total: 5 snapshots (14.1 MB)
Retention: 5 snapshots / 30 days / 500 MB max

Commands:
  claude context compaction show <id>     View snapshot details
  claude context compaction diff <id>     Compare with current context
  claude context compaction restore <id>  Restore pre-compaction state
```

**Compaction Snapshot Diff Command:**
```
$ claude context compaction diff a1b2c3

Comparing: pre-compact-20260127-143022-a1b2c3 vs Current Context
══════════════════════════════════════════════════════════════

                        Snapshot        Current         Delta
──────────────────────────────────────────────────────────────
Tokens                  180,241         47,892          -132,349
Messages                847             847 (summarized) -
Files in context        23              8               -15
Tool executions         156             42 (referenced)  -114

Lost Detail (in current compacted context):
──────────────────────────────────────────────────────────────
• Full debugging session for auth flow (messages 234-298)
• Complete file contents: src/utils/parser.ts (1,247 lines)
• Detailed error traces from failed test runs
• Step-by-step refactoring discussion (messages 445-512)

Preserved (in current compacted context):
──────────────────────────────────────────────────────────────
• Summary of architectural decisions
• Current task objectives and progress
• Key code snippets and patterns
• File modification history

Actions:
  [R] Restore full snapshot (replaces current context)
  [E] Extract specific messages to file
  [S] Search within snapshot
  [Q] Quit

Choice [R/E/S/Q]:
```

---

## Security & Privacy Considerations

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Sensitive data in persisted context | Automatic secret detection and redaction; configurable exclusion patterns |
| Unauthorized access to context files | File permissions (600); optional encryption at rest |
| Context tampering | Integrity checksums; signature verification |
| Context exfiltration via exports | Export warnings; audit logging |
| Malicious context injection | Schema validation; sandboxed restoration |

### Data Protection

**Automatic Redaction:**
- API keys and tokens (regex patterns)
- Passwords and secrets
- Private keys (PEM, SSH)
- Environment variable values from `.env` files
- Credit card numbers, SSNs (PII patterns)

**Encryption at Rest (Optional):**
- AES-256-GCM encryption
- Key derived from user passphrase or system keychain
- Enabled via `context.encryption: true` in config

**Access Controls:**
- Context files created with mode `0600` (owner read/write only)
- Export operations require explicit confirmation
- Shared contexts stripped of user-specific data

### Audit Logging

```yaml
# ~/.claude-code/audit.log
- timestamp: 2026-01-27T14:30:00Z
  action: context_save
  directory: /home/user/myproject
  size_bytes: 4200000
  messages: 523
  
- timestamp: 2026-01-27T16:45:00Z
  action: context_export
  directory: /home/user/myproject
  export_path: ./team-context.ctxpkg
  redactions_applied: 3
```

---

## Integration Points

### Claude Code Integration

**Hooks Required:**
- `onSessionStart`: Trigger context restoration check
- `onSessionEnd`: Trigger context persistence
- `onMessage`: Update context state, trigger checkpoints
- `onToolExecution`: Log tool history
- `onFileAccess`: Update file registry
- `onPreCompaction`: Trigger snapshot creation before context summarization
- `onPostCompaction`: Update snapshot metadata with post-compaction stats

**API Surface:**
```typescript
interface ContextManager {
  // Lifecycle
  initialize(workingDir: string): Promise<ContextState | null>;
  persist(): Promise<void>;
  checkpoint(): Promise<void>;
  
  // State access
  getState(): ContextState;
  updateState(patch: Partial<ContextState>): void;
  
  // Manual controls
  save(options?: SaveOptions): Promise<string>;
  restore(options?: RestoreOptions): Promise<ContextState>;
  clear(force?: boolean): Promise<void>;
  
  // Inspection
  getStatus(): ContextStatus;
  getDiff(): ContextDiff;
  export(path: string, options?: ExportOptions): Promise<void>;
  
  // Compaction snapshots
  createCompactionSnapshot(): Promise<CompactionSnapshot>;
  listCompactionSnapshots(): Promise<CompactionSnapshot[]>;
  getCompactionSnapshot(id: string): Promise<CompactionSnapshotDetail>;
  restoreCompactionSnapshot(id: string, options?: RestoreOptions): Promise<ContextState>;
  deleteCompactionSnapshot(id: string): Promise<void>;
  pinCompactionSnapshot(id: string, pinned: boolean): Promise<void>;
  pruneCompactionSnapshots(): Promise<number>; // Returns count pruned
}
```

### Shell Integration

**Directory Change Hooks:**
```bash
# .bashrc / .zshrc addition
claude_context_hook() {
  if [[ -d ".claude/context" ]]; then
    export CLAUDE_CONTEXT_DIR="$(pwd)"
  fi
}
cd() { builtin cd "$@" && claude_context_hook; }
```

**Prompt Integration:**
```bash
# Show context status in prompt
claude_prompt_info() {
  if [[ -f ".claude/context/current.ctx" ]]; then
    echo "[ctx:$(claude context status --brief)]"
  fi
}
PS1='$(claude_prompt_info) \w $ '
```

### Git Integration

**Pre-commit Hook (Optional):**
```bash
#!/bin/bash
# .git/hooks/pre-commit
# Warn if committing context files
if git diff --cached --name-only | grep -q "^\.claude/context/"; then
  echo "Warning: Committing Claude context files. Continue? [y/N]"
  read -r response
  [[ "$response" =~ ^[Yy]$ ]] || exit 1
fi
```

**Default .gitignore Entry:**
```gitignore
# Claude Code Context (added automatically)
.claude/context/
```

---

## Edge Cases & Error Handling

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Read-only directory | Use fallback location (`~/.claude-code/contexts/`) |
| Disk full during save | Attempt incremental save; warn user; preserve last checkpoint |
| Corrupted context file | Fall back to most recent valid checkpoint; warn user |
| Context schema mismatch | Attempt migration; if impossible, offer fresh start with export |
| Very large context (>100MB) | Warn user; offer compression or pruning |
| Concurrent sessions same directory | Lock file prevents conflicts; second session uses read-only mode |
| Directory renamed/moved | Content-addressable lookup by directory hash |
| Network drive / slow storage | Async persistence; don't block session exit |
| Compaction during snapshot save | Queue snapshot; complete before compaction proceeds |
| Rapid successive compactions | Debounce snapshots; minimum 5-minute interval |
| Snapshot storage limit reached | Prune oldest non-pinned; warn if all pinned |
| Compaction snapshot corrupted | Skip restoration; offer remaining snapshots; log error |
| Restore snapshot to different project | Warn user; require `--force` flag; map file paths |

### Error Messages

**Context Corruption:**
```
⚠ Context file corrupted

The context file appears to be damaged and cannot be loaded.

Options:
  [C] Load from checkpoint (cp-002, 15 minutes old)
  [H] Load from history (session-2026-01-26.ctx.gz)
  [F] Start fresh (context will be lost)
  [E] Export raw data for inspection

Choice [C/H/F/E]:
```

**Storage Limit Exceeded:**
```
⚠ Context storage limit reached (100 MB)

Current context size: 102.4 MB
Limit: 100 MB

Options:
  [P] Prune old history and checkpoints
  [C] Compress conversation history (lossy)
  [I] Increase limit (edit .claude/config.yaml)
  [X] Continue without saving

Choice [P/C/I/X]:
```

---

## Performance Requirements

| Operation | Target Latency | Notes |
|-----------|---------------|-------|
| Context restoration | <1s for <10MB | Lazy loading for larger contexts |
| Checkpoint save | <200ms | Non-blocking, async |
| Full save on exit | <500ms | Blocks exit briefly |
| Status query | <50ms | Cached metadata |
| Diff computation | <2s | May require file hashing |
| Compaction snapshot save | <2s | Async, must complete before compaction |
| Compaction snapshot list | <100ms | Index file cached in memory |
| Compaction snapshot restore | <5s for <50MB | Full context replacement |

### Optimization Strategies

1. **Lazy Loading:** Load conversation summary immediately; full history on demand
2. **Incremental Serialization:** Only serialize changed segments
3. **Compression:** LZ4 for speed; ZSTD for archival
4. **Memory Mapping:** Use mmap for large context files
5. **Background Persistence:** Async writes don't block user interaction

---

## Implementation Phases

### Phase 1: Core Persistence (MVP)
**Timeline:** 4 weeks

- Basic save/restore on session start/end
- Directory-scoped storage
- Simple CLI commands (`save`, `restore`, `status`)
- Crash recovery via checkpoints
- Configuration file support

**Exit Criteria:**
- Successfully persists and restores context across sessions
- Handles common exit scenarios (normal, Ctrl+C, SIGTERM)
- <500ms save latency for typical contexts

### Phase 2: Robustness & Polish
**Timeline:** 3 weeks

- Full CLI command set
- Context reconciliation (file change detection)
- Automatic secret redaction
- Storage management (pruning, limits)
- Comprehensive error handling

**Exit Criteria:**
- Graceful handling of all edge cases
- No data loss in crash scenarios
- User-friendly error messages and recovery options

### Phase 3: Advanced Features
**Timeline:** 3 weeks

- Named snapshots
- Export/import for team sharing
- Encryption at rest
- Git integration
- Shell prompt integration

**Exit Criteria:**
- Full feature set as specified
- Documentation complete
- Performance targets met

### Phase 4: Optimization & Scale
**Timeline:** 2 weeks

- Performance optimization
- Large context handling (>50MB)
- Telemetry and analytics
- A/B testing framework for UX refinements

**Exit Criteria:**
- All performance requirements met
- Telemetry operational
- Ready for GA release

---

## Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | Should context include actual file contents or just references? | Engineering | Open |
| 2 | What is the maximum practical context size before degradation? | Engineering | Open |
| 3 | Should we support cloud sync for cross-device persistence? | Product | Deferred to v2 |
| 4 | How do we handle context for monorepos with multiple sub-projects? | Product | Open |
| 5 | Should context summarization be AI-assisted for compression? | Engineering | Open |
| 6 | What telemetry is acceptable to collect? | Legal/Privacy | Open |
| 7 | Should we integrate with Claude.ai memory system? | Product | Open |
| 8 | How do we handle context when Claude Code version updates? | Engineering | Open |
| 9 | Should compaction snapshots capture the exact prompt/system state? | Engineering | Open |
| 10 | Can we offer "replay" functionality from compaction snapshots? | Product | Open |
| 11 | Should snapshots be searchable across all projects globally? | Product | Open |
| 12 | How do we handle snapshots when context includes sensitive code? | Security | Open |
| 13 | Should we offer automatic "important moment" detection for snapshots? | Engineering | Open |

---

## Appendix A: Competitive Analysis

| Feature | Ben10 | Cursor | Continue.dev | Codeium |
|---------|------|--------|--------------|---------|
| Auto-persist context | ✓ | Partial | ✗ | ✗ |
| Directory-scoped | ✓ | ✗ | ✗ | ✗ |
| Crash recovery | ✓ | ✗ | ✗ | ✗ |
| Context inspection | ✓ | ✗ | ✗ | ✗ |
| Export/share | ✓ | ✗ | ✗ | ✗ |
| Encryption | ✓ | N/A | N/A | N/A |
| Pre-compaction snapshots | ✓ | ✗ | ✗ | ✗ |
| Snapshot restoration | ✓ | ✗ | ✗ | ✗ |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| Context Window | The set of information (messages, file contents, tool outputs) available to Claude during a session |
| Checkpoint | A periodic snapshot of context state for crash recovery |
| Context Reconciliation | The process of updating persisted context when underlying files have changed |
| Token | A unit of text processed by the language model (~4 characters) |
| Serialization | Converting in-memory context state to a persistent format |
| Compaction | The process by which Claude Code summarizes/compresses context when approaching token limits, resulting in loss of detail |
| Compaction Snapshot | A complete capture of the uncompacted context state taken immediately before compaction occurs |
| Pinned Snapshot | A compaction snapshot marked as protected from automatic pruning/deletion |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-27 | Product Management | Initial draft |
| 1.1 | 2026-01-27 | Product Management | Added FR-7: Pre-Compaction Snapshots feature |

---

*This document is confidential and intended for internal use only.*
