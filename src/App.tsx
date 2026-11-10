import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./App.css";
import { db, seedDefaultSettings } from "./lib/db";
import {
  createNoteLockCredential,
  type NoteLockCredential,
  verifyNoteLockPassword,
} from "./lib/note-lock";
import {
  contentToEditorHtml,
  richTextToPlainText,
  sanitizeRichTextHtml,
} from "./lib/rich-text";
import {
  isSupabaseConfigured,
  normaliseSupabaseUser,
  supabase,
  type AppUser,
} from "./lib/supabase";
import {
  deleteNotebookLocally,
  saveNoteLocally,
  syncUserNotes,
} from "./lib/sync";
import type { Notebook, Note } from "./types";

const DEMO_USER_ID = "demo-user";
const DEMO_USER_NAME = "Demo user";
type ThemeMode = "light" | "dark";
type NoteViewMode = "list" | "grid";
type NoteSortMode = "modified" | "created" | "name-asc" | "name-desc";
type NoteLockDialogMode = "create" | "change" | "recover";
type NoteLockSettingsStatus =
  | "loading"
  | "configured"
  | "unconfigured"
  | "error";
type NoteMenuAction = "rename" | "delete" | "pin" | "lock";
type NoteLockActionState = {
  noteId: string;
  mode: "lock" | "unlock" | "remove-lock";
  openAfterUnlock: boolean;
};
type NoteMenuState = {
  noteId: string;
  x: number;
  y: number;
};
type EditorToolbarPanel = "text" | "lists" | null;
type InlineFormat = "bold" | "italic" | "underline";
type NoteListFormat = "bullet" | "numbered" | "dashed" | "checkbox";

const DEVICE_USER_SETTING_KEY = "device-user";

const createEmptyNote = (userId: string): Note => {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    title: "Untitled note",
    content: "",
    content_type: "text",
    created_at: now,
    updated_at: now,
    version: 1,
    deleted_at: null,
    is_archived: false,
    is_pinned: false,
    notebook_id: null,
    color: "#f7f7f7",
    metadata_json: {},
    sync_status: "pending",
  };
};

const createEmptyNotebook = (userId: string, name: string): Notebook => ({
  id: crypto.randomUUID(),
  user_id: userId,
  name,
  parent_id: null,
  created_at: new Date().toISOString(),
  sync_status: "pending",
});

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      className="trash-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="m6 7 1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 64 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M17 33V21a15 15 0 0 1 30 0v12"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M13 31h38a5 5 0 0 1 5 5v27a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8V36a5 5 0 0 1 5-5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [noteViewMode, setNoteViewMode] = useState<NoteViewMode>("list");
  const [noteSortMode, setNoteSortMode] = useState<NoteSortMode>("modified");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [hasFolderOverflow, setHasFolderOverflow] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    new Set(),
  );
  const [folders, setFolders] = useState<Notebook[]>([]);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderActionError, setFolderActionError] = useState<string | null>(
    null,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [noteActionError, setNoteActionError] = useState<string | null>(null);
  const [unlockedNoteIds, setUnlockedNoteIds] = useState<Set<string>>(
    new Set(),
  );
  const [animatingNoteIds, setAnimatingNoteIds] = useState<Set<string>>(
    new Set(),
  );
  const [noteLockSettingsStatus, setNoteLockSettingsStatus] =
    useState<NoteLockSettingsStatus>("loading");
  const [noteLockDialogMode, setNoteLockDialogMode] =
    useState<NoteLockDialogMode | null>(null);
  const [noteLockOldPassword, setNoteLockOldPassword] = useState("");
  const [noteLockNewPassword, setNoteLockNewPassword] = useState("");
  const [noteLockConfirmPassword, setNoteLockConfirmPassword] = useState("");
  const [noteLockDialogError, setNoteLockDialogError] = useState<string | null>(
    null,
  );
  const [noteLockSaving, setNoteLockSaving] = useState(false);
  const [noteLockAction, setNoteLockAction] =
    useState<NoteLockActionState | null>(null);
  const [noteLockActionPassword, setNoteLockActionPassword] = useState("");
  const [noteLockActionError, setNoteLockActionError] = useState<string | null>(
    null,
  );
  const [noteLockRecoveryVerified, setNoteLockRecoveryVerified] =
    useState(false);
  const [noteMenu, setNoteMenu] = useState<NoteMenuState | null>(null);
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isClosingNote, setIsClosingNote] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState<string>("50% 50%");
  const [zoomOriginReady, setZoomOriginReady] = useState(false);
  const zoomOriginPointRef = useRef<{ x: number; y: number } | null>(null);
  const closeNoteTimeoutRef = useRef<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [editorToolbarPanel, setEditorToolbarPanel] =
    useState<EditorToolbarPanel>(null);
  const [activeInlineFormats, setActiveInlineFormats] = useState<
    Record<InlineFormat, boolean>
  >({
    bold: false,
    italic: false,
    underline: false,
  });
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [isHydrating, setIsHydrating] = useState(true);
  const saveTimeoutRef = useRef<number | null>(null);
  const notesRef = useRef<Note[]>([]);
  const pendingDraftRef = useRef<Note | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressNoteClickRef = useRef(false);
  const suppressOutsideNoteClickRef = useRef(false);
  const suppressOutsideNoteClickTimerRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDetailsElement | null>(null);
  const navigationDrawerRef = useRef<HTMLElement | null>(null);
  const navigationScrollRef = useRef<HTMLDivElement | null>(null);
  const noteTitleInputRef = useRef<HTMLInputElement | null>(null);
  const richTextEditorRef = useRef<HTMLDivElement | null>(null);
  const editorToolbarRef = useRef<HTMLDivElement | null>(null);
  const editorSelectionRangeRef = useRef<Range | null>(null);
  const noteSectionAnimationTimers = useRef<Map<string, number>>(new Map());
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNewNoteClickRef = useRef(false);
  const suppressNewNoteClickTimerRef = useRef<number | null>(null);
  const suppressMenuClickRef = useRef(false);
  const suppressMenuClickTimerRef = useRef<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const themeClassName = theme === "dark" ? "theme-dark" : "theme-light";
  const currentUserId = currentUser?.id ?? null;

  useEffect(() => {
    return () => {
      if (closeNoteTimeoutRef.current !== null) {
        window.clearTimeout(closeNoteTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#080808" : "#ffffff");
  }, [theme]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateKeyboardInset = () => {
      if (window.innerWidth > 820 || !viewport) {
        document.documentElement.style.setProperty(
          "--mobile-keyboard-inset",
          "0px",
        );
        return;
      }

      const bottomInset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      document.documentElement.style.setProperty(
        "--mobile-keyboard-inset",
        `${bottomInset}px`,
      );
    };

    updateKeyboardInset();
    viewport?.addEventListener("resize", updateKeyboardInset);
    viewport?.addEventListener("scroll", updateKeyboardInset);
    window.addEventListener("resize", updateKeyboardInset);
    window.addEventListener("orientationchange", updateKeyboardInset);

    return () => {
      viewport?.removeEventListener("resize", updateKeyboardInset);
      viewport?.removeEventListener("scroll", updateKeyboardInset);
      window.removeEventListener("resize", updateKeyboardInset);
      window.removeEventListener("orientationchange", updateKeyboardInset);
      document.documentElement.style.removeProperty("--mobile-keyboard-inset");
    };
  }, []);

  const openNoteMenu = (noteId: string, x: number, y: number) => {
    setNoteMenu({
      noteId,
      x: Math.max(8, Math.min(x, window.innerWidth - 208)),
      y: Math.max(8, Math.min(y, window.innerHeight - 208)),
    });
  };

  const handleNotePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    noteId: string,
  ) => {
    suppressNoteClickRef.current = false;
    if (event.pointerType !== "touch") {
      return;
    }

    longPressOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNoteClickRef.current = true;
      openNoteMenu(noteId, event.clientX, event.clientY);
      longPressTimerRef.current = null;
    }, 550);
  };

  const cancelNoteLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  };

  const handleNotePointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const origin = longPressOriginRef.current;
    if (
      origin &&
      (Math.abs(event.clientX - origin.x) > 12 ||
        Math.abs(event.clientY - origin.y) > 12)
    ) {
      cancelNoteLongPress();
    }
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !contextMenuRef.current?.contains(event.target)
      ) {
        setNoteMenu(null);
      }
      if (
        event.target instanceof Node &&
        !settingsMenuRef.current?.contains(event.target)
      ) {
        setSettingsOpen(false);
      }
      if (
        event.target instanceof Node &&
        !editorToolbarRef.current?.contains(event.target)
      ) {
        setEditorToolbarPanel(null);
      }
      if (
        event.target instanceof Node &&
        navigationDrawerRef.current?.classList.contains("is-open") &&
        !navigationDrawerRef.current.contains(event.target)
      ) {
        const tappedNote =
          event.target instanceof Element &&
          event.target.closest(".note-item") !== null;
        if (tappedNote) {
          cancelNoteLongPress();
          suppressOutsideNoteClickRef.current = true;
          if (suppressOutsideNoteClickTimerRef.current !== null) {
            window.clearTimeout(suppressOutsideNoteClickTimerRef.current);
          }
          suppressOutsideNoteClickTimerRef.current = window.setTimeout(() => {
            suppressOutsideNoteClickRef.current = false;
            suppressOutsideNoteClickTimerRef.current = null;
          }, 800);
        }
        setNavigationOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNoteMenu(null);
        setRenamingNoteId(null);
        setNoteLockDialogMode(null);
        setNoteLockAction(null);
        setEditorToolbarPanel(null);
        setNavigationOpen(false);
        setSettingsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      if (suppressNewNoteClickTimerRef.current !== null) {
        window.clearTimeout(suppressNewNoteClickTimerRef.current);
      }
      if (suppressMenuClickTimerRef.current !== null) {
        window.clearTimeout(suppressMenuClickTimerRef.current);
      }
      if (suppressOutsideNoteClickTimerRef.current !== null) {
        window.clearTimeout(suppressOutsideNoteClickTimerRef.current);
      }
      for (const timer of noteSectionAnimationTimers.current.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadStoredTheme = async () => {
      await seedDefaultSettings();

      const storedTheme = await db.settings.get("ui-theme");
      const nextTheme = storedTheme?.value === "light" ? "light" : "dark";
      const storedViewMode = await db.settings.get("note-view-mode");
      const nextViewMode = storedViewMode?.value === "grid" ? "grid" : "list";
      const storedSortMode = await db.settings.get("note-sort-mode");
      const sortModes: NoteSortMode[] = [
        "modified",
        "created",
        "name-asc",
        "name-desc",
      ];
      const nextSortMode =
        typeof storedSortMode?.value === "string" &&
        sortModes.includes(storedSortMode.value as NoteSortMode)
          ? (storedSortMode.value as NoteSortMode)
          : "modified";

      if (active) {
        setTheme(nextTheme);
        setNoteViewMode(nextViewMode);
        setNoteSortMode(nextSortMode);
      }
    };

    void loadStoredTheme();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setUnlockedNoteIds(new Set());
    setNoteLockSettingsStatus("loading");
    setNoteLockDialogMode(null);
    setNoteLockAction(null);
    setNoteLockRecoveryVerified(false);

    if (!currentUserId) {
      setNoteLockSettingsStatus("unconfigured");
      return () => {
        active = false;
      };
    }

    const loadLockSettings = async () => {
      try {
        const setting = await db.settings.get(
          `note-lock-password:${currentUserId}`,
        );
        if (!setting) {
          if (active) {
            setNoteLockSettingsStatus("unconfigured");
          }
          return;
        }
        if (typeof setting.value !== "string") {
          throw new Error("Stored note-lock password settings are invalid.");
        }
        const credential: unknown = JSON.parse(setting.value);
        if (
          !credential ||
          typeof credential !== "object" ||
          !("salt" in credential) ||
          !("hash" in credential) ||
          typeof credential.salt !== "string" ||
          typeof credential.hash !== "string"
        ) {
          throw new Error("Stored note-lock password settings are invalid.");
        }
        if (active) {
          setNoteLockSettingsStatus("configured");
        }
      } catch (error) {
        console.error("Unable to load note-lock settings", error);
        if (active) {
          setNoteLockSettingsStatus("error");
          setNoteLockDialogError(
            error instanceof Error
              ? error.message
              : "Unable to load note-lock settings.",
          );
        }
      }
    };

    void loadLockSettings();

    return () => {
      active = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    let active = true;
    const authClient = supabase;

    if (!isSupabaseConfigured || !authClient) {
      setCurrentUser({
        id: DEMO_USER_ID,
        email: "demo@local",
        name: DEMO_USER_NAME,
      });
      setIsHydrating(false);
      return () => {
        active = false;
      };
    }

    const restoreDeviceUser = async () => {
      try {
        const setting = await db.settings.get(DEVICE_USER_SETTING_KEY);
        if (typeof setting?.value !== "string") {
          return null;
        }

        const cachedUser: unknown = JSON.parse(setting.value);
        if (
          !cachedUser ||
          typeof cachedUser !== "object" ||
          !("id" in cachedUser) ||
          typeof cachedUser.id !== "string" ||
          !("email" in cachedUser) ||
          typeof cachedUser.email !== "string" ||
          !("name" in cachedUser) ||
          typeof cachedUser.name !== "string"
        ) {
          throw new Error("Stored device account settings are invalid.");
        }
        return {
          id: cachedUser.id,
          email: cachedUser.email,
          name: cachedUser.name,
        };
      } catch (error) {
        console.error("Unable to restore the device account", error);
        return null;
      }
    };

    const cacheDeviceUser = (user: AppUser) => {
      void db.settings
        .put({
          key: DEVICE_USER_SETTING_KEY,
          value: JSON.stringify(user),
          updated_at: new Date().toISOString(),
        })
        .catch((error: unknown) => {
          console.error("Unable to save the device account", error);
        });
    };

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((event, session) => {
      if (active) {
        const user = normaliseSupabaseUser(session?.user ?? null);
        if (user) {
          cacheDeviceUser(user);
          setCurrentUser(user);
        } else if (event === "SIGNED_OUT" && navigator.onLine) {
          void db.settings
            .delete(DEVICE_USER_SETTING_KEY)
            .catch((error: unknown) => {
              console.error("Unable to clear the device account", error);
            });
          setCurrentUser(null);
        } else if (!navigator.onLine) {
          void restoreDeviceUser().then((cachedUser) => {
            if (active && cachedUser) {
              setCurrentUser(cachedUser);
            }
          });
        } else {
          setCurrentUser(null);
        }
      }
    });

    const restoreSession = async () => {
      try {
        const {
          data: { session },
          error,
        } = await authClient.auth.getSession();

        if (error) {
          throw error;
        }

        if (active) {
          const user = normaliseSupabaseUser(session?.user ?? null);
          if (user) {
            cacheDeviceUser(user);
            setCurrentUser(user);
          } else if (!navigator.onLine) {
            setCurrentUser(await restoreDeviceUser());
          } else {
            void db.settings
              .delete(DEVICE_USER_SETTING_KEY)
              .catch((deleteError: unknown) => {
                console.error(
                  "Unable to clear the device account",
                  deleteError,
                );
              });
            setCurrentUser(null);
          }
        }
      } catch (error) {
        if (active) {
          const cachedUser = await restoreDeviceUser();
          if (cachedUser) {
            setCurrentUser(cachedUser);
          } else {
            setAuthError(
              error instanceof Error
                ? error.message
                : "Unable to restore your session.",
            );
          }
        }
      } finally {
        if (active) {
          setIsHydrating(false);
        }
      }
    };

    void restoreSession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setNotes([]);
      setFolders([]);
      setSelectedId(null);
      setSelectedFolderId(null);
      return;
    }

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setNotes([]);
      setSelectedId(null);
      return;
    }

    const loadNotes = async () => {
      await seedDefaultSettings();

      if (navigator.onLine && isSupabaseConfigured) {
        await syncUserNotes(currentUser.id);
      }

      const storedNotes = await db.notes.toArray();
      const userNotes = storedNotes
        .filter((note) => note.user_id === currentUser.id)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const storedNotebooks = (await db.notebooks.toArray())
        .filter((notebook) => notebook.user_id === currentUser.id)
        .sort((a, b) => a.name.localeCompare(b.name));

      setNotes(userNotes);
      setFolders(storedNotebooks);
      setExpandedFolderIds(
        (previous) =>
          new Set([
            ...previous,
            ...storedNotebooks.map((notebook) => notebook.id),
          ]),
      );

      if (selectedId && !userNotes.some((note) => note.id === selectedId)) {
        setSelectedId(null);
      }
    };

    void loadNotes();
  }, [currentUser, selectedId]);

  useEffect(() => {
    const handleOnlineStatus = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && currentUser) {
        void syncUserNotes(currentUser.id).then(async () => {
          const storedNotes = await db.notes.toArray();
          const userNotes = storedNotes
            .filter((note) => note.user_id === currentUser.id)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
          const storedNotebooks = (await db.notebooks.toArray())
            .filter((notebook) => notebook.user_id === currentUser.id)
            .sort((a, b) => a.name.localeCompare(b.name));
          setNotes(userNotes);
          setFolders(storedNotebooks);
        });
      }
    };

    window.addEventListener("online", handleOnlineStatus);
    window.addEventListener("offline", handleOnlineStatus);

    if (navigator.onLine && currentUser) {
      handleOnlineStatus();
    }

    return () => {
      window.removeEventListener("online", handleOnlineStatus);
      window.removeEventListener("offline", handleOnlineStatus);
    };
  }, [currentUser]);

  const activeNotes = useMemo(
    () => notes.filter((note) => !note.deleted_at),
    [notes],
  );

  useEffect(() => {
    const scrollArea = navigationScrollRef.current;
    if (!scrollArea) {
      return;
    }

    const updateOverflow = () => {
      setHasFolderOverflow(
        scrollArea.scrollHeight > scrollArea.clientHeight + 1,
      );
    };
    const animationFrame = window.requestAnimationFrame(updateOverflow);
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(scrollArea);
    scrollArea
      .querySelectorAll(":scope > *")
      .forEach((child) => resizeObserver.observe(child));
    window.addEventListener("resize", updateOverflow);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [
    navigationOpen,
    folders.length,
    expandedFolderIds,
    isCreatingFolder,
    activeNotes.length,
  ]);

  const visibleNotes = useMemo(
    () =>
      activeNotes
        .filter((note) => note.notebook_id === selectedFolderId)
        .sort((a, b) => {
          if (noteSortMode === "created") {
            return b.created_at.localeCompare(a.created_at);
          }
          if (noteSortMode === "name-asc") {
            return a.title.localeCompare(b.title, undefined, {
              sensitivity: "base",
            });
          }
          if (noteSortMode === "name-desc") {
            return b.title.localeCompare(a.title, undefined, {
              sensitivity: "base",
            });
          }
          return b.updated_at.localeCompare(a.updated_at);
        }),
    [activeNotes, selectedFolderId, noteSortMode],
  );
  const pinnedNotes = useMemo(
    () => visibleNotes.filter((note) => note.is_pinned),
    [visibleNotes],
  );
  const regularNotes = useMemo(
    () => visibleNotes.filter((note) => !note.is_pinned),
    [visibleNotes],
  );

  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  const notesByFolder = useMemo(() => {
    const grouped = new Map<string, Note[]>();
    for (const note of activeNotes) {
      if (note.notebook_id) {
        grouped.set(note.notebook_id, [
          ...(grouped.get(note.notebook_id) ?? []),
          note,
        ]);
      }
    }
    return grouped;
  }, [activeNotes]);

  const selectedNote = useMemo(() => {
    const note =
      activeNotes.find((candidate) => candidate.id === selectedId) ?? null;
    return note &&
      (note.metadata_json.note_locked !== true || unlockedNoteIds.has(note.id))
      ? note
      : null;
  }, [activeNotes, selectedId, unlockedNoteIds]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    if (!selectedId) {
      setDraftTitle("");
      setEditorToolbarPanel(null);
      editorSelectionRangeRef.current = null;
      return;
    }

    if (selectedNote) {
      setDraftTitle(selectedNote.title);
    } else {
      setDraftTitle("");
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedNote && richTextEditorRef.current) {
      richTextEditorRef.current.innerHTML = contentToEditorHtml(
        selectedNote.content,
      );
    }
  }, [selectedId]);

  useLayoutEffect(() => {
    if (!selectedId) {
      setZoomOriginReady(false);
      return;
    }

    const origin = zoomOriginPointRef.current;
    const workspace = workspaceRef.current;
    if (!origin || !workspace) {
      setZoomOrigin("50% 50%");
      setZoomOriginReady(true);
      return;
    }

    const workspaceRect = workspace.getBoundingClientRect();
    setZoomOrigin(
      `${Math.round(origin.x - workspaceRect.left)}px ${Math.round(origin.y - workspaceRect.top)}px`,
    );
    setZoomOriginReady(true);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) {
      noteTitleInputRef.current?.focus();
      noteTitleInputRef.current?.setSelectionRange(
        noteTitleInputRef.current.value.length,
        noteTitleInputRef.current.value.length,
      );
    }
  }, [selectedId]);

  const syncLabel = !online
    ? "Offline mode active"
    : isSupabaseConfigured
      ? notes.some((note) => note.sync_status === "error")
        ? "Sync needs attention"
        : notes.some((note) => note.sync_status === "pending")
          ? "Changes waiting to sync"
          : "Synced to cloud"
      : "Demo mode / cloud pending";

  const handleThemeToggle = async () => {
    const nextTheme: ThemeMode = theme === "light" ? "dark" : "light";

    setTheme(nextTheme);
    await db.settings.put({
      key: "ui-theme",
      value: nextTheme,
      updated_at: new Date().toISOString(),
    });
  };

  const handleNoteViewModeChange = async (nextMode: NoteViewMode) => {
    setNoteViewMode(nextMode);
    await db.settings.put({
      key: "note-view-mode",
      value: nextMode,
      updated_at: new Date().toISOString(),
    });
  };

  const handleNoteSortModeChange = async (nextMode: NoteSortMode) => {
    setNoteSortMode(nextMode);
    await db.settings.put({
      key: "note-sort-mode",
      value: nextMode,
      updated_at: new Date().toISOString(),
    });
  };

  const saveNote = async (nextNote: Note) => {
    const latestStored = notesRef.current.find(
      (note) => note.id === nextNote.id,
    );

    if (
      latestStored &&
      (latestStored.version > nextNote.version ||
        (latestStored.version === nextNote.version &&
          latestStored.updated_at > nextNote.updated_at))
    ) {
      return;
    }

    const updatedNote: Note = {
      ...nextNote,
      updated_at: new Date().toISOString(),
      sync_status: "pending",
    };

    await saveNoteLocally(updatedNote, "update");

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      await syncUserNotes(currentUser.id);
    }

    const savedNote = (await db.notes.get(updatedNote.id)) ?? updatedNote;
    setNotes((previousNotes) => {
      const current = previousNotes.find((note) => note.id === savedNote.id);

      if (
        current &&
        (current.version > savedNote.version ||
          (current.version === savedNote.version &&
            current.updated_at > savedNote.updated_at))
      ) {
        return previousNotes;
      }

      const nextNotes = previousNotes
        .map((note) => (note.id === savedNote.id ? savedNote : note))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

      notesRef.current = nextNotes;
      return nextNotes;
    });
  };

  const getNoteLockCredential =
    async (): Promise<NoteLockCredential | null> => {
      if (!currentUser) {
        return null;
      }

      const setting = await db.settings.get(
        `note-lock-password:${currentUser.id}`,
      );
      if (!setting) {
        return null;
      }
      if (typeof setting.value !== "string") {
        throw new Error("Stored note-lock password settings are invalid.");
      }

      const credential: unknown = JSON.parse(setting.value);
      if (
        !credential ||
        typeof credential !== "object" ||
        !("salt" in credential) ||
        !("hash" in credential) ||
        typeof credential.salt !== "string" ||
        typeof credential.hash !== "string"
      ) {
        throw new Error("Stored note-lock password settings are invalid.");
      }
      return {
        salt: credential.salt,
        hash: credential.hash,
      };
    };

  const triggerNoteMoveAnimation = (noteId: string) => {
    const existingTimer = noteSectionAnimationTimers.current.get(noteId);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }
    setAnimatingNoteIds((current) => new Set(current).add(noteId));
    const timer = window.setTimeout(() => {
      setAnimatingNoteIds((current) => {
        const next = new Set(current);
        next.delete(noteId);
        return next;
      });
      noteSectionAnimationTimers.current.delete(noteId);
    }, 650);
    noteSectionAnimationTimers.current.set(noteId, timer);
  };

  const updateNoteMetadata = async (
    target: Note,
    changes: { isPinned?: boolean; isLocked?: boolean },
  ) => {
    const latestTarget =
      notesRef.current.find((note) => note.id === target.id) ?? target;
    const updatedNote: Note = {
      ...latestTarget,
      is_pinned: changes.isPinned ?? latestTarget.is_pinned,
      metadata_json:
        changes.isLocked === undefined
          ? latestTarget.metadata_json
          : { ...latestTarget.metadata_json, note_locked: changes.isLocked },
      updated_at: new Date().toISOString(),
      version: latestTarget.version + 1,
      sync_status: "pending",
    };

    await saveNoteLocally(updatedNote, "update");
    const nextNotes = notesRef.current
      .map((note) => (note.id === updatedNote.id ? updatedNote : note))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    notesRef.current = nextNotes;
    setNotes(nextNotes);

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      void syncUserNotes(currentUser.id);
    }
    return updatedNote;
  };

  const handleToggleNotePin = async (noteId: string) => {
    const target = notesRef.current.find((note) => note.id === noteId);
    if (!target) {
      return;
    }

    setNoteActionError(null);
    try {
      await updateNoteMetadata(target, { isPinned: !target.is_pinned });
      triggerNoteMoveAnimation(noteId);
    } catch (error) {
      console.error("Unable to update note pin state", error);
      setNoteActionError(
        error instanceof Error
          ? error.message
          : "Unable to update this note. Please try again.",
      );
    }
    setNoteMenu(null);
  };

  const handleCloseNote = () => {
    if (closeNoteTimeoutRef.current !== null) {
      window.clearTimeout(closeNoteTimeoutRef.current);
    }
    setIsClosingNote(true);
    closeNoteTimeoutRef.current = window.setTimeout(() => {
      setSelectedId(null);
      setIsClosingNote(false);
      closeNoteTimeoutRef.current = null;
    }, 280);
  };

  const handleOpenNote = async (
    note: Note,
    originElement?: HTMLElement | null,
  ) => {
    setZoomOriginReady(false);
    if (closeNoteTimeoutRef.current !== null) {
      window.clearTimeout(closeNoteTimeoutRef.current);
      closeNoteTimeoutRef.current = null;
    }

    if (originElement) {
      const rect = originElement.getBoundingClientRect();
      zoomOriginPointRef.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    } else {
      zoomOriginPointRef.current = null;
    }

    setIsClosingNote(false);
    setNoteActionError(null);
    if (
      note.metadata_json.note_locked === true &&
      !unlockedNoteIds.has(note.id)
    ) {
      try {
        const credential = await getNoteLockCredential();
        if (!credential) {
          setNoteActionError(
            "Set a note lock password in Settings before unlocking notes.",
          );
          setNavigationOpen(true);
          setSettingsOpen(true);
          return;
        }
        setNoteLockAction({
          noteId: note.id,
          mode: "unlock",
          openAfterUnlock: true,
        });
        setNoteLockActionPassword("");
        setNoteLockActionError(null);
        return;
      } catch (error) {
        console.error("Unable to unlock note", error);
        setNoteActionError(
          error instanceof Error
            ? error.message
            : "Unable to unlock this note.",
        );
        return;
      }
    }
    setSelectedId(note.id);
  };

  const handleToggleNoteLock = async (noteId: string) => {
    const target = notesRef.current.find((note) => note.id === noteId);
    if (!target) {
      return;
    }

    setNoteMenu(null);
    setNoteActionError(null);
    try {
      const credential = await getNoteLockCredential();
      if (!credential) {
        setNoteActionError(
          "Set a note lock password in Settings before locking notes.",
        );
        setNavigationOpen(true);
        setSettingsOpen(true);
        return;
      }

      const isLocked = target.metadata_json.note_locked === true;
      setNoteLockAction({
        noteId,
        mode: isLocked ? "remove-lock" : "lock",
        openAfterUnlock: false,
      });
      setNoteLockActionPassword("");
      setNoteLockActionError(null);
      if (selectedId === noteId) {
        setSelectedId(null);
      }
    } catch (error) {
      console.error("Unable to update note lock state", error);
      setNoteActionError(
        error instanceof Error
          ? error.message
          : "Unable to update this note. Please try again.",
      );
    }
  };

  const handleNoteLockActionSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!noteLockAction) {
      return;
    }

    setNoteLockActionError(null);
    try {
      const credential = await getNoteLockCredential();
      if (!credential) {
        throw new Error(
          "Set a note lock password in Settings before locking notes.",
        );
      }
      if (!(await verifyNoteLockPassword(noteLockActionPassword, credential))) {
        setNoteLockActionError("Wrong note lock password.");
        return;
      }

      const target = notesRef.current.find(
        (note) => note.id === noteLockAction.noteId,
      );
      if (!target) {
        throw new Error("This note is no longer available.");
      }

      if (noteLockAction.mode === "unlock") {
        setUnlockedNoteIds((current) => new Set(current).add(target.id));
        if (noteLockAction.openAfterUnlock) {
          setSelectedId(target.id);
        }
      } else if (noteLockAction.mode === "remove-lock") {
        await updateNoteMetadata(target, { isLocked: false });
        setUnlockedNoteIds((current) => {
          const next = new Set(current);
          next.delete(target.id);
          return next;
        });
      } else {
        await updateNoteMetadata(target, { isLocked: true });
        setUnlockedNoteIds((current) => {
          const next = new Set(current);
          next.delete(target.id);
          return next;
        });
        if (selectedId === target.id) {
          setSelectedId(null);
        }
      }
      setNoteLockAction(null);
      setNoteLockActionPassword("");
    } catch (error) {
      console.error("Unable to complete note lock action", error);
      setNoteLockActionError(
        error instanceof Error ? error.message : "Unable to update this note.",
      );
    }
  };

  const openNoteLockDialog = (mode: NoteLockDialogMode) => {
    setNoteLockDialogMode(mode);
    setNoteLockOldPassword("");
    setNoteLockNewPassword("");
    setNoteLockConfirmPassword("");
    setNoteLockDialogError(null);
    setNoteLockRecoveryVerified(false);
  };

  const handleNoteLockSettingsSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!noteLockDialogMode || !currentUser) {
      return;
    }

    setNoteLockSaving(true);
    setNoteLockDialogError(null);
    try {
      if (noteLockDialogMode === "recover" && !noteLockRecoveryVerified) {
        if (
          !isSupabaseConfigured ||
          !supabase ||
          currentUser.email === "demo@local"
        ) {
          setNoteLockDialogError(
            "Password recovery is unavailable in demo mode. Set a new password while signed in to your account.",
          );
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({
          email: currentUser.email,
          password: noteLockOldPassword,
        });
        if (error) {
          setNoteLockDialogError("Wrong login password.");
          return;
        }
        setNoteLockRecoveryVerified(true);
        setNoteLockOldPassword("");
        return;
      }

      if (noteLockNewPassword.length < 8) {
        setNoteLockDialogError("Use a password with at least 8 characters.");
        return;
      }
      if (noteLockNewPassword !== noteLockConfirmPassword) {
        setNoteLockDialogError("The new passwords do not match.");
        return;
      }

      if (noteLockDialogMode === "change") {
        const existingCredential = await getNoteLockCredential();
        if (!existingCredential) {
          throw new Error("No note lock password is set for this account.");
        }
        if (
          !(await verifyNoteLockPassword(
            noteLockOldPassword,
            existingCredential,
          ))
        ) {
          setNoteLockDialogError("Wrong note lock password.");
          return;
        }
      }

      const credential = await createNoteLockCredential(noteLockNewPassword);
      await db.settings.put({
        key: `note-lock-password:${currentUser.id}`,
        value: JSON.stringify(credential),
        updated_at: new Date().toISOString(),
      });
      setNoteLockSettingsStatus("configured");
      setNoteLockDialogMode(null);
      setNoteLockDialogError(null);
    } catch (error) {
      console.error("Unable to save note lock password", error);
      setNoteLockDialogError(
        error instanceof Error
          ? error.message
          : "Unable to save the note lock password.",
      );
    } finally {
      setNoteLockSaving(false);
    }
  };

  const createNote = async (notebookId: string | null = selectedFolderId) => {
    const userId = currentUser?.id ?? DEMO_USER_ID;
    const newNote = createEmptyNote(userId);
    const readyNote: Note = {
      ...newNote,
      notebook_id: notebookId,
      sync_status: "pending",
    };

    setNoteActionError(null);
    try {
      await saveNoteLocally(readyNote, "create");
    } catch (error) {
      console.error("Unable to save the new note locally", error);
      setNoteActionError(
        error instanceof Error
          ? error.message
          : "Unable to create a note. Please try again.",
      );
      return;
    }

    setNotes((previousNotes) => [readyNote, ...previousNotes]);
    setSelectedId(readyNote.id);
    setNavigationOpen(false);

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      void syncUserNotes(currentUser.id);
    }
  };

  const handleCreateFolder = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) {
      setFolderActionError("Enter a folder name.");
      return;
    }
    if (
      folders.some(
        (folder) =>
          folder.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      setFolderActionError("A folder with that name already exists.");
      return;
    }

    const notebook = createEmptyNotebook(currentUser?.id ?? DEMO_USER_ID, name);
    setFolderActionError(null);
    try {
      await db.notebooks.put(notebook);
    } catch (error) {
      console.error("Unable to save the folder locally", error);
      setFolderActionError(
        error instanceof Error
          ? error.message
          : "Unable to create the folder. Please try again.",
      );
      return;
    }

    setFolders((previousFolders) =>
      [...previousFolders, notebook].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
    setExpandedFolderIds((previous) => new Set(previous).add(notebook.id));
    setSelectedFolderId(notebook.id);
    setSelectedId(null);
    setFolderName("");
    setIsCreatingFolder(false);

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      void syncUserNotes(currentUser.id).then(async () => {
        const savedNotebook = await db.notebooks.get(notebook.id);
        if (savedNotebook) {
          setFolders((previousFolders) =>
            previousFolders.map((folder) =>
              folder.id === savedNotebook.id ? savedNotebook : folder,
            ),
          );
        }
      });
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) {
      return;
    }

    const folderNotes = notesRef.current.filter(
      (note) => note.notebook_id === folderId && !note.deleted_at,
    );
    const noteDescription =
      folderNotes.length === 1 ? "1 note" : `${folderNotes.length} notes`;
    const confirmation =
      folderNotes.length > 0
        ? `Delete "${folder.name}" and its ${noteDescription}? This cannot be undone.`
        : `Delete "${folder.name}"? This cannot be undone.`;
    if (!window.confirm(confirmation)) {
      return;
    }

    setFolderActionError(null);
    try {
      const deletedNotes = await deleteNotebookLocally(
        folderId,
        folder.user_id,
        folderNotes,
      );
      const deletedNoteIds = new Set(deletedNotes.map((note) => note.id));
      const nextNotes = notesRef.current.map((note) =>
        deletedNoteIds.has(note.id)
          ? (deletedNotes.find((deletedNote) => deletedNote.id === note.id) ??
            note)
          : note,
      );
      notesRef.current = nextNotes;
      setNotes(nextNotes);
      setFolders((previousFolders) =>
        previousFolders.filter((item) => item.id !== folderId),
      );
      setExpandedFolderIds((previous) => {
        const next = new Set(previous);
        next.delete(folderId);
        return next;
      });
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
      if (selectedId && deletedNoteIds.has(selectedId)) {
        setSelectedId(null);
      }
      if (
        pendingDraftRef.current &&
        deletedNoteIds.has(pendingDraftRef.current.id)
      ) {
        pendingDraftRef.current = null;
        if (saveTimeoutRef.current !== null) {
          window.clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
      }
      setNavigationOpen(false);

      if (navigator.onLine && isSupabaseConfigured) {
        void syncUserNotes(folder.user_id);
      }
    } catch (error) {
      console.error("Unable to delete the folder locally", error);
      setFolderActionError(
        error instanceof Error
          ? error.message
          : "Unable to delete the folder. Please try again.",
      );
    }
  };

  const handleNewNoteTouchEnd = () => {
    suppressNewNoteClickRef.current = true;
    if (suppressNewNoteClickTimerRef.current !== null) {
      window.clearTimeout(suppressNewNoteClickTimerRef.current);
    }
    suppressNewNoteClickTimerRef.current = window.setTimeout(() => {
      suppressNewNoteClickRef.current = false;
      suppressNewNoteClickTimerRef.current = null;
    }, 800);
    void createNote();
  };

  const handleNewNoteClick = () => {
    if (suppressNewNoteClickRef.current) {
      suppressNewNoteClickRef.current = false;
      if (suppressNewNoteClickTimerRef.current !== null) {
        window.clearTimeout(suppressNewNoteClickTimerRef.current);
        suppressNewNoteClickTimerRef.current = null;
      }
      return;
    }
    void createNote();
  };

  const persistNoteChange = (nextNote: Note) => {
    pendingDraftRef.current = nextNote;

    notesRef.current = notesRef.current.map((note) =>
      note.id === nextNote.id ? nextNote : note,
    );

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      const latestDraft = pendingDraftRef.current;
      if (!latestDraft) {
        return;
      }

      const currentStored = notesRef.current.find(
        (note) => note.id === latestDraft.id,
      );
      if (currentStored && currentStored.version > latestDraft.version) {
        pendingDraftRef.current = null;
        return;
      }

      pendingDraftRef.current = null;
      void saveNote(latestDraft);
    }, 180);
  };

  const handleTitleChange = (value: string) => {
    if (!selectedId) {
      return;
    }

    const currentNote = notesRef.current.find((note) => note.id === selectedId);

    if (!currentNote) {
      return;
    }

    const updatedNote: Note = {
      ...currentNote,
      title: value,
      updated_at: new Date().toISOString(),
      version: currentNote.version + 1,
      sync_status: "pending",
    };

    setDraftTitle(value);
    persistNoteChange(updatedNote);
  };

  const handleContentChange = (value: string) => {
    if (!selectedId) {
      return;
    }

    const currentNote = notesRef.current.find((note) => note.id === selectedId);

    if (!currentNote) {
      return;
    }

    const safeContent = sanitizeRichTextHtml(value);
    const updatedNote: Note = {
      ...currentNote,
      content: safeContent,
      updated_at: new Date().toISOString(),
      version: currentNote.version + 1,
      sync_status: "pending",
    };

    persistNoteChange(updatedNote);
  };

  const captureEditorSelection = () => {
    const editor = richTextEditorRef.current;
    const selection = window.getSelection();
    if (
      editor &&
      selection?.rangeCount &&
      editor.contains(selection.anchorNode) &&
      editor.contains(selection.focusNode)
    ) {
      editorSelectionRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const normalizeEditorLists = (editor: HTMLDivElement) => {
    editor.querySelectorAll("li[value]").forEach((listItem) => {
      listItem.removeAttribute("value");
    });
    editor
      .querySelectorAll<HTMLLIElement>("ul.note-list-checkbox > li")
      .forEach((listItem) => {
        if (!listItem.querySelector(":scope > .note-checkbox-marker")) {
          const marker = document.createElement("span");
          marker.className = "note-checkbox-marker";
          marker.contentEditable = "false";
          marker.setAttribute("role", "checkbox");
          marker.setAttribute(
            "aria-checked",
            listItem.dataset.checked === "true" ? "true" : "false",
          );
          marker.tabIndex = 0;
          listItem.prepend(marker);
        }
      });
    editor
      .querySelectorAll("ul:not(.note-list-checkbox) .note-checkbox-marker")
      .forEach((marker) => {
        marker.remove();
      });

    editor.querySelectorAll("ol").forEach((list) => {
      let next = list.nextElementSibling;
      while (next?.tagName === "OL") {
        while (next.firstChild) {
          list.append(next.firstChild);
        }
        const mergedList = next;
        next = next.nextElementSibling;
        mergedList.remove();
      }
    });
  };

  const moveCaretAfterCheckboxMarker = (listItem: HTMLLIElement) => {
    const marker = listItem.querySelector(":scope > .note-checkbox-marker");
    const selection = window.getSelection();
    if (!marker || !selection?.rangeCount || !selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    const markerStart = document.createRange();
    markerStart.setStartBefore(marker);
    markerStart.collapse(true);
    if (range.compareBoundaryPoints(Range.START_TO_START, markerStart) > 0) {
      return;
    }

    const caretRange = document.createRange();
    caretRange.setStartAfter(marker);
    caretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caretRange);
    editorSelectionRangeRef.current = caretRange.cloneRange();
  };

  const normalizeCheckboxCaret = () => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const listItem =
      anchor instanceof Element
        ? anchor.closest("li")
        : anchor?.parentElement?.closest("li");
    if (listItem instanceof HTMLLIElement) {
      moveCaretAfterCheckboxMarker(listItem);
    }
  };

  const restoreEditorSelection = () => {
    const editor = richTextEditorRef.current;
    const range = editorSelectionRangeRef.current;
    if (!editor || !range || !editor.contains(range.commonAncestorContainer)) {
      editor?.focus();
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const refreshInlineFormatState = () => {
    setActiveInlineFormats({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
    });
  };

  const persistRichEditorContent = () => {
    const editor = richTextEditorRef.current;
    if (!editor) {
      return;
    }
    normalizeEditorLists(editor);
    handleContentChange(editor.innerHTML);
    captureEditorSelection();
    refreshInlineFormatState();
  };

  const toggleCheckboxListItem = (listItem: Element) => {
    const checked = listItem.getAttribute("data-checked") !== "true";
    if (checked) {
      listItem.setAttribute("data-checked", "true");
    } else {
      listItem.removeAttribute("data-checked");
    }
    listItem
      .querySelector(":scope > .note-checkbox-marker")
      ?.setAttribute("aria-checked", checked ? "true" : "false");
    persistRichEditorContent();
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === " " && event.target instanceof Element) {
      const marker = event.target.closest(".note-checkbox-marker");
      const listItem = marker?.closest("li");
      if (listItem) {
        event.preventDefault();
        toggleCheckboxListItem(listItem);
      }
      return;
    }

    if (event.key !== "Enter" || !event.shiftKey) {
      return;
    }

    const editor = richTextEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }

    event.preventDefault();
    range.deleteContents();
    const lineBreak = document.createElement("br");
    range.insertNode(lineBreak);
    range.setStartAfter(lineBreak);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    persistRichEditorContent();
  };

  const handleEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const marker = event.target.closest(".note-checkbox-marker");
    const listItem = marker?.closest("li");
    if (!marker || !listItem) {
      return;
    }

    toggleCheckboxListItem(listItem);
  };

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const editor = richTextEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }

    const pastedHtml = event.clipboardData.getData("text/html");
    const pastedText = event.clipboardData.getData("text/plain");
    const fragment = pastedHtml
      ? range.createContextualFragment(sanitizeRichTextHtml(pastedHtml))
      : document.createDocumentFragment();

    if (!pastedHtml) {
      const lines = pastedText.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (index > 0) {
          fragment.append(document.createElement("br"));
        }
        fragment.append(document.createTextNode(line));
      });
    }

    range.deleteContents();
    const lastInsertedNode = fragment.lastChild;
    range.insertNode(fragment);
    if (lastInsertedNode) {
      range.setStartAfter(lastInsertedNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    persistRichEditorContent();
  };

  const applyEditorCommand = (command: string, value?: string) => {
    restoreEditorSelection();
    document.execCommand(command, false, value);
    persistRichEditorContent();
  };

  const changeEditorFontSize = (direction: -1 | 1) => {
    restoreEditorSelection();
    const selection = window.getSelection();
    const selectedElement =
      selection?.anchorNode instanceof Element
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
    const currentSize = selectedElement
      ? Number.parseFloat(window.getComputedStyle(selectedElement).fontSize)
      : 16;
    const sizeSteps = [10, 13, 16, 18, 24, 32, 48];
    const currentIndex = sizeSteps.reduce(
      (closest, size, index) =>
        Math.abs(size - currentSize) <
        Math.abs(sizeSteps[closest] - currentSize)
          ? index
          : closest,
      0,
    );
    const nextIndex = Math.max(
      0,
      Math.min(sizeSteps.length - 1, currentIndex + direction),
    );
    document.execCommand("fontSize", false, String(nextIndex + 1));
    persistRichEditorContent();
  };

  const applyListFormat = (format: NoteListFormat) => {
    restoreEditorSelection();
    const selection = window.getSelection();
    const selectionRange = selection?.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : null;
    const anchor = selection?.anchorNode;
    const listItem =
      anchor instanceof Element
        ? anchor.closest("li")
        : anchor?.parentElement?.closest("li");
    const containingList =
      listItem?.parentElement instanceof HTMLOListElement ||
      listItem?.parentElement instanceof HTMLUListElement
        ? listItem.parentElement
        : null;
    const currentFormat: NoteListFormat | null = containingList
      ? containingList.tagName === "OL"
        ? "numbered"
        : containingList.classList.contains("note-list-checkbox")
          ? "checkbox"
          : containingList.classList.contains("note-list-dashed")
            ? "dashed"
            : "bullet"
      : null;

    if (containingList && listItem) {
      const desiredFormat = currentFormat === format ? null : format;
      const listItems = Array.from(containingList.children).filter(
        (child): child is HTMLLIElement => child instanceof HTMLLIElement,
      );
      const intersectingItems =
        selectionRange && !selectionRange.collapsed
          ? listItems.filter((item) => selectionRange.intersectsNode(item))
          : [];
      const affectedItems = intersectingItems.includes(listItem)
        ? intersectingItems
        : [listItem];
      const firstSelectedIndex = listItems.indexOf(affectedItems[0]);
      const lastSelectedIndex = listItems.indexOf(
        affectedItems[affectedItems.length - 1],
      );
      const beforeList = containingList.cloneNode(false) as
        | HTMLOListElement
        | HTMLUListElement;
      const afterList = containingList.cloneNode(false) as
        | HTMLOListElement
        | HTMLUListElement;
      const listStart =
        containingList instanceof HTMLOListElement
          ? Number(containingList.getAttribute("start") ?? 1)
          : 1;
      const replacementList = desiredFormat
        ? document.createElement(desiredFormat === "numbered" ? "ol" : "ul")
        : null;
      const paragraphs = new Map<HTMLLIElement, HTMLParagraphElement>();
      const parent = containingList.parentNode;

      if (!parent || firstSelectedIndex < 0 || lastSelectedIndex < 0) {
        return;
      }

      if (replacementList && desiredFormat === "dashed") {
        replacementList.classList.add("note-list-dashed");
      }
      if (replacementList && desiredFormat === "checkbox") {
        replacementList.classList.add("note-list-checkbox");
      }
      if (replacementList instanceof HTMLOListElement) {
        replacementList.start = 1;
      }
      if (afterList instanceof HTMLOListElement) {
        afterList.start = listStart + firstSelectedIndex + affectedItems.length;
      }

      while (
        containingList.firstChild &&
        containingList.firstChild !== affectedItems[0]
      ) {
        beforeList.append(containingList.firstChild);
      }

      for (const item of affectedItems) {
        containingList.removeChild(item);
        item.querySelector(":scope > .note-checkbox-marker")?.remove();
        if (desiredFormat === null) {
          item.removeAttribute("data-checked");
          const paragraph = document.createElement("p");
          while (item.firstChild) {
            paragraph.append(item.firstChild);
          }
          paragraphs.set(item, paragraph);
          continue;
        }

        if (desiredFormat === "checkbox") {
          const marker = document.createElement("span");
          marker.className = "note-checkbox-marker";
          marker.contentEditable = "false";
          marker.setAttribute("role", "checkbox");
          marker.setAttribute(
            "aria-checked",
            item.dataset.checked === "true" ? "true" : "false",
          );
          marker.tabIndex = 0;
          item.prepend(marker);
        } else {
          item.removeAttribute("data-checked");
        }
        replacementList?.append(item);
      }

      while (containingList.firstChild) {
        afterList.append(containingList.firstChild);
      }

      if (beforeList.children.length > 0) {
        parent.insertBefore(beforeList, containingList);
      }
      if (replacementList) {
        parent.insertBefore(replacementList, containingList);
      } else {
        for (const item of affectedItems) {
          const paragraph = paragraphs.get(item);
          if (paragraph) {
            parent.insertBefore(paragraph, containingList);
          }
        }
      }
      if (afterList.children.length > 0) {
        parent.insertBefore(afterList, containingList);
      }
      parent.removeChild(containingList);

      const editor = richTextEditorRef.current;
      if (
        selectionRange &&
        editor?.contains(selectionRange.commonAncestorContainer)
      ) {
        selection?.removeAllRanges();
        selection?.addRange(selectionRange);
      } else if (desiredFormat === null) {
        const paragraph = paragraphs.get(listItem);
        if (paragraph) {
          const caretRange = document.createRange();
          caretRange.selectNodeContents(paragraph);
          caretRange.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(caretRange);
        }
      }
      if (desiredFormat === "checkbox") {
        moveCaretAfterCheckboxMarker(listItem);
      }
    } else {
      document.execCommand(
        format === "numbered" ? "insertOrderedList" : "insertUnorderedList",
      );
      const newAnchor = window.getSelection()?.anchorNode;
      const newList =
        newAnchor instanceof Element
          ? newAnchor.closest("ul, ol")
          : newAnchor?.parentElement?.closest("ul, ol");
      if (newList && format === "dashed") {
        newList.classList.add("note-list-dashed");
      }
      if (newList && format === "checkbox") {
        newList.classList.add("note-list-checkbox");
        if (richTextEditorRef.current) {
          normalizeEditorLists(richTextEditorRef.current);
        }
        const newAnchor = window.getSelection()?.anchorNode;
        const newListItem =
          newAnchor instanceof Element
            ? newAnchor.closest("li")
            : newAnchor?.parentElement?.closest("li");
        if (newListItem instanceof HTMLLIElement) {
          moveCaretAfterCheckboxMarker(newListItem);
        }
      }
    }

    persistRichEditorContent();
    setEditorToolbarPanel(null);
  };

  const handleDelete = async (noteId: string) => {
    const target = notesRef.current.find((note) => note.id === noteId);

    if (!target) {
      return;
    }

    const updatedNote: Note = {
      ...target,
      deleted_at: new Date().toISOString(),
      sync_status: "pending",
      updated_at: new Date().toISOString(),
      version: target.version + 1,
    };

    try {
      await saveNoteLocally(updatedNote, "delete");
    } catch (error) {
      console.error("Unable to delete the note locally", error);
      setNoteActionError(
        error instanceof Error
          ? error.message
          : "Unable to delete this note. Please try again.",
      );
      return;
    }

    const nextNotes = notesRef.current.filter((note) => note.id !== noteId);
    notesRef.current = nextNotes;
    setNotes(nextNotes);

    if (selectedId === noteId) {
      setSelectedId(null);
    }

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      void syncUserNotes(currentUser.id);
    }
  };

  const beginRename = (noteId: string) => {
    const noteToRename = notesRef.current.find((note) => note.id === noteId);
    if (noteToRename) {
      setRenameValue(noteToRename.title);
      setRenamingNoteId(noteToRename.id);
    }
    setNoteMenu(null);
  };

  const activateNoteMenuAction = (action: NoteMenuAction, noteId: string) => {
    if (action === "rename") {
      beginRename(noteId);
    } else if (action === "delete") {
      void handleDelete(noteId);
      setNoteMenu(null);
    } else if (action === "pin") {
      void handleToggleNotePin(noteId);
    } else {
      void handleToggleNoteLock(noteId);
    }
  };

  const handleNoteMenuActionTouchEnd = (
    event: React.TouchEvent<HTMLButtonElement>,
    action: NoteMenuAction,
    noteId: string,
  ) => {
    event.stopPropagation();
    suppressMenuClickRef.current = true;
    if (suppressMenuClickTimerRef.current !== null) {
      window.clearTimeout(suppressMenuClickTimerRef.current);
    }
    suppressMenuClickTimerRef.current = window.setTimeout(() => {
      suppressMenuClickRef.current = false;
      suppressMenuClickTimerRef.current = null;
    }, 800);
    activateNoteMenuAction(action, noteId);
  };

  const handleNoteMenuActionClick = (
    action: NoteMenuAction,
    noteId: string,
  ) => {
    if (suppressMenuClickRef.current) {
      suppressMenuClickRef.current = false;
      if (suppressMenuClickTimerRef.current !== null) {
        window.clearTimeout(suppressMenuClickTimerRef.current);
        suppressMenuClickTimerRef.current = null;
      }
      return;
    }
    activateNoteMenuAction(action, noteId);
  };

  const handleRename = async (noteId: string, title: string) => {
    const target = notesRef.current.find((note) => note.id === noteId);
    if (!target) {
      return;
    }

    const updatedNote: Note = {
      ...target,
      title,
      updated_at: new Date().toISOString(),
      version: target.version + 1,
      sync_status: "pending",
    };

    try {
      await saveNoteLocally(updatedNote, "update");
    } catch (error) {
      console.error("Unable to rename the note locally", error);
      setNoteActionError(
        error instanceof Error
          ? error.message
          : "Unable to rename this note. Please try again.",
      );
      return;
    }

    const nextNotes = notesRef.current
      .map((note) => (note.id === noteId ? updatedNote : note))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    if (selectedId === noteId) {
      setDraftTitle(title);
      pendingDraftRef.current = null;
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    }
    setRenamingNoteId(null);

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      void syncUserNotes(currentUser.id);
    }
  };

  const handleCloudSignIn = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setCurrentUser({
        id: DEMO_USER_ID,
        email: "demo@local",
        name: DEMO_USER_NAME,
      });
      setAuthError(null);
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthNotice(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Unable to sign in right now.",
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCloudSignUp = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setCurrentUser({
        id: DEMO_USER_ID,
        email: "demo@local",
        name: DEMO_USER_NAME,
      });
      setAuthError(null);
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthNotice(null);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      if (!data.session) {
        setAuthNotice(
          "Account created. Check your email to confirm your address, then sign in.",
        );
      }
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Unable to create account right now.",
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (supabase && isSupabaseConfigured) {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        setAuthError(error.message);
        return;
      }
    }

    void db.settings.delete(DEVICE_USER_SETTING_KEY).catch((error: unknown) => {
      console.error("Unable to clear the device account", error);
    });
    setCurrentUser(null);
    setEmail("");
    setPassword("");
    setAuthError(null);
    setAuthNotice(null);
  };

  if (!currentUser && !isHydrating) {
    return (
      <div className="auth-shell theme-dark">
        <div className="auth-card">
          <p className="eyebrow">Persistent session ready</p>
          <h1>Welcome back</h1>

          <p className="auth-note">
            {isSupabaseConfigured
              ? "Sign in to restore your synced notes."
              : "Cloud is not configured yet, so we are using the local demo mode."}
          </p>

          <label className="field-label">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="field-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>

          {authError ? <p className="auth-error">{authError}</p> : null}
          {authNotice ? (
            <p className="auth-note" role="status">
              {authNotice}
            </p>
          ) : null}

          <div className="auth-actions">
            <button
              type="button"
              className="primary-button"
              onClick={handleCloudSignIn}
              disabled={authLoading}
            >
              {authLoading ? "Please wait..." : "Sign in"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleCloudSignUp}
              disabled={authLoading}
            >
              Create account
            </button>
            {!isSupabaseConfigured ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setCurrentUser({
                    id: DEMO_USER_ID,
                    email: "demo@local",
                    name: DEMO_USER_NAME,
                  })
                }
              >
                Continue in demo mode
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (isHydrating) {
    return (
      <div className="auth-shell theme-dark">
        <div className="auth-card compact">
          <p>Loading your notes...</p>
        </div>
      </div>
    );
  }

  const renderNoteCard = (note: Note) => {
    const isLocked = note.metadata_json.note_locked === true;
    const isUnlocked = unlockedNoteIds.has(note.id);

    return (
      <button
        key={note.id}
        type="button"
        className={[
          "note-item",
          selectedId === note.id ? "selected" : "",
          noteMenu?.noteId === note.id ? "context-open" : "",
          animatingNoteIds.has(note.id) ? "is-moving" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onPointerDown={(event) => handleNotePointerDown(event, note.id)}
        onPointerMove={handleNotePointerMove}
        onPointerUp={cancelNoteLongPress}
        onPointerCancel={cancelNoteLongPress}
        onClickCapture={(event) => {
          if (suppressOutsideNoteClickRef.current) {
            suppressOutsideNoteClickRef.current = false;
            if (suppressOutsideNoteClickTimerRef.current !== null) {
              window.clearTimeout(suppressOutsideNoteClickTimerRef.current);
              suppressOutsideNoteClickTimerRef.current = null;
            }
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          openNoteMenu(note.id, event.clientX, event.clientY);
        }}
        onClick={(event) => {
          if (suppressNoteClickRef.current) {
            suppressNoteClickRef.current = false;
            event.preventDefault();
            return;
          }
          void handleOpenNote(note, event.currentTarget);
        }}
      >
        <span className="note-item-title">
          {note.title || "Untitled note"}
          {isLocked ? (
            <span
              className="note-lock-indicator"
              role="img"
              aria-label={isUnlocked ? "Unlocked" : "Locked"}
            >
              <LockIcon />
            </span>
          ) : null}
        </span>
        {noteViewMode === "grid" ? (
          isLocked && !isUnlocked ? (
            <span
              className="note-item-preview note-locked-tile-icon"
              role="img"
              aria-label="Locked"
            >
              <LockIcon />
            </span>
          ) : (
            <span className="note-item-preview">
              {richTextToPlainText(note.content) || "No additional text"}
            </span>
          )
        ) : null}
        <span className="note-item-details">
          <span className="note-item-meta">
            {new Date(note.updated_at).toLocaleDateString()}
          </span>
          <span className="note-item-state">{note.sync_status}</span>
        </span>
      </button>
    );
  };
  const noteMenuTarget = noteMenu
    ? activeNotes.find((note) => note.id === noteMenu.noteId)
    : undefined;
  const noteMenuTargetIsLocked =
    noteMenuTarget?.metadata_json.note_locked === true;

  return (
    <>
      <div
        className={`app-shell ${themeClassName} ${selectedNote ? "mobile-note-open" : ""} ${isClosingNote ? "mobile-note-closing" : ""}`}
      >
        <header className="topbar">
          <div>
            <p className="eyebrow">Offline-first notes</p>
            <h1>
              {selectedFolderId
                ? (folderNameById.get(selectedFolderId) ?? "General Notes")
                : "General Notes"}
            </h1>
          </div>

          <div className="topbar-actions">
            <label
              className={`view-select-wrap ${selectedNote && noteViewMode !== "list" ? "hide-when-note-open" : ""}`}
            >
              <span className="visually-hidden">Note layout</span>
              <select
                className="view-select"
                aria-label="Note layout"
                value={noteViewMode}
                onChange={(event) =>
                  void handleNoteViewModeChange(
                    event.target.value === "grid" ? "grid" : "list",
                  )
                }
              >
                <option value="list">☰ List</option>
                <option value="grid">▦ Tiles</option>
              </select>
            </label>
            <label
              className={`sort-select-wrap ${selectedNote && noteViewMode !== "list" ? "hide-when-note-open" : ""}`}
            >
              <span className="visually-hidden">Sort notes</span>
              <select
                className="sort-select"
                aria-label="Sort notes"
                value={noteSortMode}
                onChange={(event) =>
                  void handleNoteSortModeChange(
                    event.target.value as NoteSortMode,
                  )
                }
              >
                <option value="modified">Modified</option>
                <option value="created">Created</option>
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
              </select>
            </label>
            <button
              type="button"
              className="navigation-toggle"
              aria-label={navigationOpen ? "Close sidebar" : "Open sidebar"}
              aria-expanded={navigationOpen}
              aria-controls="navigation-drawer"
              onClick={() => {
                setSettingsOpen(false);
                setNavigationOpen((open) => !open);
              }}
            >
              <span className="hamburger-icon" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void createNote()}
            >
              + New note
            </button>
          </div>
        </header>

        {navigationOpen ? (
          <div className="navigation-backdrop" aria-hidden="true" />
        ) : null}
        <aside
          ref={navigationDrawerRef}
          id="navigation-drawer"
          className={`navigation-drawer ${navigationOpen ? "is-open" : ""}`}
          aria-label="Notes navigation"
          aria-hidden={!navigationOpen}
        >
          <div className="navigation-drawer-header">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>Folders</h2>
            </div>
            <button
              type="button"
              className="navigation-close"
              aria-label="Close sidebar"
              onClick={() => setNavigationOpen(false)}
            >
              ×
            </button>
          </div>
          <div
            ref={navigationScrollRef}
            className={`navigation-scroll-area ${hasFolderOverflow ? "has-folder-overflow" : ""}`}
          >
            <button
              type="button"
              className={`navigation-general ${selectedFolderId === null ? "is-selected" : ""}`}
              onClick={() => {
                setSelectedFolderId(null);
                setSelectedId(null);
                setNavigationOpen(false);
              }}
            >
              <span aria-hidden="true">⌂</span>
              <span>General Notes</span>
              <span className="navigation-count">
                {activeNotes.filter((note) => !note.notebook_id).length}
              </span>
            </button>
            <div className="navigation-section-title">
              <span>Folders</span>
              <button
                type="button"
                className="navigation-add-folder"
                aria-label="Create folder"
                title="Create folder"
                onClick={() => {
                  setFolderActionError(null);
                  setIsCreatingFolder(true);
                }}
              >
                +
              </button>
            </div>
            {isCreatingFolder ? (
              <form
                className="folder-create-form"
                onSubmit={(event) => void handleCreateFolder(event)}
              >
                <input
                  autoFocus
                  aria-label="New folder name"
                  placeholder="Folder name"
                  value={folderName}
                  maxLength={80}
                  onChange={(event) => setFolderName(event.target.value)}
                />
                <button type="submit" className="primary-button">
                  Create
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setIsCreatingFolder(false);
                    setFolderName("");
                    setFolderActionError(null);
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : null}
            {folderActionError ? (
              <p className="folder-error" role="alert">
                {folderActionError}
              </p>
            ) : null}
            {folders.length === 0 && !isCreatingFolder ? (
              <p className="navigation-empty">Your folders will appear here.</p>
            ) : null}
            {folders.map((folder) => {
              const folderNotes = notesByFolder.get(folder.id) ?? [];
              const isExpanded = expandedFolderIds.has(folder.id);
              return (
                <div className="navigation-folder" key={folder.id}>
                  <div className="navigation-folder-row">
                    <button
                      type="button"
                      className={`navigation-folder-select ${selectedFolderId === folder.id ? "is-selected" : ""}`}
                      onClick={() => {
                        setSelectedFolderId(folder.id);
                        setSelectedId(null);
                        setNavigationOpen(false);
                      }}
                    >
                      <span
                        className="navigation-folder-icon"
                        aria-hidden="true"
                      >
                        ▰
                      </span>
                      <span className="navigation-folder-name">
                        {folder.name}
                      </span>
                      {folder.sync_status === "error" ? (
                        <span
                          className="folder-sync-error"
                          title="Folder sync needs attention"
                        >
                          !
                        </span>
                      ) : null}
                      <span className="navigation-count">
                        {folderNotes.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="navigation-folder-action"
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${folder.name}`}
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedFolderIds((previous) => {
                          const next = new Set(previous);
                          if (next.has(folder.id)) {
                            next.delete(folder.id);
                          } else {
                            next.add(folder.id);
                          }
                          return next;
                        })
                      }
                    >
                      {isExpanded ? "⌄" : "›"}
                    </button>
                    <button
                      type="button"
                      className="navigation-folder-action"
                      aria-label={`Create note in ${folder.name}`}
                      title={`Create note in ${folder.name}`}
                      onClick={() => void createNote(folder.id)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="navigation-folder-action navigation-folder-delete"
                      aria-label={`Delete folder ${folder.name}`}
                      title={`Delete folder ${folder.name}`}
                      onClick={() => void handleDeleteFolder(folder.id)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  {isExpanded ? (
                    <div className="navigation-folder-notes">
                      {folderNotes.length === 0 ? (
                        <span className="navigation-empty-note">
                          No notes yet
                        </span>
                      ) : (
                        folderNotes.map((note) => (
                          <button
                            type="button"
                            key={note.id}
                            className={`navigation-note ${selectedId === note.id ? "is-selected" : ""}`}
                            onClick={(event) => {
                              setSelectedFolderId(folder.id);
                              setNavigationOpen(false);
                              void handleOpenNote(note, event.currentTarget);
                            }}
                          >
                            <span aria-hidden="true">
                              {note.metadata_json.note_locked === true
                                ? "🔒"
                                : "▤"}
                            </span>
                            <span>{note.title || "Untitled note"}</span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="navigation-settings-footer">
            <details
              ref={settingsMenuRef}
              className="settings-menu navigation-settings"
              open={settingsOpen}
              onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
            >
              <summary
                aria-label="Settings"
                title="Settings"
                onClick={(event) => {
                  event.preventDefault();
                  setSettingsOpen((open) => !open);
                }}
              >
                <span aria-hidden="true">⚙️</span>
                <span>Settings</span>
                <span className="settings-chevron" aria-hidden="true" />
              </summary>
              <div className="settings-panel">
                <div className="settings-row">
                  <span>Appearance</span>
                  <button
                    type="button"
                    className="secondary-button theme-icon-button"
                    onClick={() => void handleThemeToggle()}
                    aria-label={
                      theme === "dark"
                        ? "Switch to light mode"
                        : "Switch to dark mode"
                    }
                    title={
                      theme === "dark"
                        ? "Switch to light mode"
                        : "Switch to dark mode"
                    }
                  >
                    {theme === "dark" ? "☀️" : "🌙"}
                  </button>
                </div>
                <div className="settings-row">
                  <span>Connection</span>
                  <span
                    className={`connection-indicator ${online ? "online" : "offline"}`}
                    role="status"
                    aria-label={online ? "Online" : "Offline"}
                    title={online ? "Online" : "Offline"}
                  >
                    {online ? "🟢" : "🟠"}
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary-button settings-sign-out"
                  disabled={
                    noteLockSettingsStatus === "loading" ||
                    noteLockSettingsStatus === "error"
                  }
                  onClick={() =>
                    openNoteLockDialog(
                      noteLockSettingsStatus === "configured"
                        ? "change"
                        : "create",
                    )
                  }
                >
                  {noteLockSettingsStatus === "loading"
                    ? "Checking note lock..."
                    : noteLockSettingsStatus === "error"
                      ? "Unable to check note lock"
                      : noteLockSettingsStatus === "configured"
                        ? "Change note lock password"
                        : "Set note lock password"}
                </button>
                <p className="settings-security-note">
                  Note locking hides content in this app only; it does not
                  encrypt stored notes.
                </p>
                <button
                  type="button"
                  className="secondary-button settings-sign-out"
                  onClick={() => {
                    setSettingsOpen(false);
                    setNavigationOpen(false);
                    void handleSignOut();
                  }}
                >
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </aside>

        {noteActionError ? (
          <p className="app-error" role="alert">
            {noteActionError}
          </p>
        ) : null}

        <div
          ref={workspaceRef}
          className={[
            "workspace",
            `view-${noteViewMode}`,
            selectedNote ? "note-open" : "",
            isClosingNote ? "note-closing" : "",
            zoomOriginReady ? "zoom-origin-ready" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <aside className="sidebar">
            <div className="sidebar-header">
              <strong>{currentUser?.name ?? DEMO_USER_NAME}</strong>
              <span>{syncLabel}</span>
            </div>

            <div
              className={`note-list ${noteViewMode === "grid" ? "grid-view" : "list-view"}`}
            >
              {visibleNotes.length === 0 ? (
                <div className="empty-state">
                  <p>No notes yet</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void createNote()}
                  >
                    Create one
                  </button>
                </div>
              ) : (
                <>
                  {pinnedNotes.length > 0 ? (
                    <>
                      <h2 className="note-section-heading">Pinned Notes</h2>
                      {pinnedNotes.map(renderNoteCard)}
                    </>
                  ) : null}
                  {regularNotes.length > 0 && pinnedNotes.length > 0 ? (
                    <h2 className="note-section-heading">Notes</h2>
                  ) : null}
                  {regularNotes.map(renderNoteCard)}
                </>
              )}
            </div>
          </aside>

          <main
            className="editor-panel"
            style={
              noteViewMode === "grid"
                ? ({ transformOrigin: zoomOrigin } as React.CSSProperties)
                : undefined
            }
          >
            {selectedNote ? (
              <>
                <div className="editor-header">
                  <button
                    type="button"
                    className="secondary-button editor-back"
                    aria-label="Back to notes"
                    title="Back to notes"
                    onClick={handleCloseNote}
                  >
                    <svg
                      className="editor-back-icon"
                      aria-hidden="true"
                      viewBox="0 0 48 48"
                      fill="none"
                    >
                      <path
                        d="M36 5 12 24l24 19"
                        stroke="currentColor"
                        strokeWidth="9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <input
                    ref={noteTitleInputRef}
                    autoFocus
                    aria-label="Note title"
                    value={draftTitle}
                    onChange={(event) => handleTitleChange(event.target.value)}
                    placeholder="Untitled note"
                  />

                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => handleDelete(selectedNote.id)}
                    aria-label="Delete note"
                    title="Delete note"
                  >
                    <TrashIcon />
                  </button>
                </div>

                <div
                  ref={richTextEditorRef}
                  className="rich-text-editor"
                  role="textbox"
                  aria-label="Note content"
                  aria-multiline="true"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Write your note..."
                  onInput={persistRichEditorContent}
                  onKeyDown={handleEditorKeyDown}
                  onClick={handleEditorClick}
                  onPaste={handleEditorPaste}
                  onKeyUp={() => {
                    normalizeCheckboxCaret();
                    captureEditorSelection();
                    refreshInlineFormatState();
                  }}
                  onMouseUp={() => {
                    normalizeCheckboxCaret();
                    captureEditorSelection();
                    refreshInlineFormatState();
                  }}
                  onBlur={captureEditorSelection}
                />

                <div ref={editorToolbarRef} className="editor-format-toolbar">
                  {editorToolbarPanel ? (
                    <div
                      className="editor-format-options"
                      role="toolbar"
                      aria-label={
                        editorToolbarPanel === "text"
                          ? "Text formatting"
                          : "List formatting"
                      }
                    >
                      {editorToolbarPanel === "text" ? (
                        <>
                          <button
                            type="button"
                            aria-label="Decrease font size"
                            title="Decrease font size"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              changeEditorFontSize(-1);
                            }}
                          >
                            A−
                          </button>
                          <button
                            type="button"
                            aria-label="Increase font size"
                            title="Increase font size"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              changeEditorFontSize(1);
                            }}
                          >
                            A+
                          </button>
                          <span className="editor-toolbar-divider" />
                          {(
                            [
                              ["bold", "Bold", "B"],
                              ["italic", "Italic", "I"],
                              ["underline", "Underline", "U"],
                            ] as const
                          ).map(([format, label, icon]) => (
                            <button
                              type="button"
                              key={format}
                              className={`format-${format}`}
                              aria-label={label}
                              title={label}
                              aria-pressed={activeInlineFormats[format]}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                applyEditorCommand(format);
                                setEditorToolbarPanel(null);
                              }}
                            >
                              {icon}
                            </button>
                          ))}
                          <span className="editor-toolbar-divider" />
                          <button
                            type="button"
                            aria-label="Decrease indent"
                            title="Decrease indent"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              applyEditorCommand("outdent");
                            }}
                          >
                            ⇤
                          </button>
                          <button
                            type="button"
                            aria-label="Increase indent"
                            title="Increase indent"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              applyEditorCommand("indent");
                            }}
                          >
                            ⇥
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            aria-label="Bulleted list"
                            title="Bulleted list"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyListFormat("bullet")}
                          >
                            • Bullets
                          </button>
                          <button
                            type="button"
                            aria-label="Numbered list"
                            title="Numbered list"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyListFormat("numbered")}
                          >
                            1. Numbering
                          </button>
                          <button
                            type="button"
                            aria-label="Dashed list"
                            title="Dashed list"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyListFormat("dashed")}
                          >
                            – Dashed
                          </button>
                          <button
                            type="button"
                            aria-label="Checkbox list"
                            title="Checkbox list"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyListFormat("checkbox")}
                          >
                            ◯ Checklist
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                  <div className="editor-format-buttons">
                    <button
                      type="button"
                      className={
                        editorToolbarPanel === "text" ? "is-active" : ""
                      }
                      aria-label="Text formatting options"
                      aria-expanded={editorToolbarPanel === "text"}
                      onMouseDown={(event) => {
                        captureEditorSelection();
                        event.preventDefault();
                      }}
                      onClick={() =>
                        setEditorToolbarPanel((current) =>
                          current === "text" ? null : "text",
                        )
                      }
                    >
                      Aa
                    </button>
                    <button
                      type="button"
                      className={
                        editorToolbarPanel === "lists" ? "is-active" : ""
                      }
                      aria-label="List formatting options"
                      aria-expanded={editorToolbarPanel === "lists"}
                      onMouseDown={(event) => {
                        captureEditorSelection();
                        event.preventDefault();
                      }}
                      onClick={() =>
                        setEditorToolbarPanel((current) =>
                          current === "lists" ? null : "lists",
                        )
                      }
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                        <circle cx="4" cy="6" r="1.5" fill="currentColor" />
                        <circle cx="4" cy="12" r="1.5" fill="currentColor" />
                        <circle cx="4" cy="18" r="1.5" fill="currentColor" />
                        <path
                          d="M8 6h12M8 12h12M8 18h12"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-editor">
                <h2>Select a note</h2>
                <p>Your notes will appear here once they are created.</p>
              </div>
            )}
          </main>
        </div>
      </div>
      {createPortal(
        <>
          {noteMenu ? (
            <div
              ref={contextMenuRef}
              className={`note-context-menu ${themeClassName}`}
              role="menu"
              aria-label="Note options"
              style={{ left: noteMenu.x, top: noteMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                role="menuitem"
                onTouchEnd={(event) =>
                  handleNoteMenuActionTouchEnd(event, "rename", noteMenu.noteId)
                }
                onClick={() =>
                  handleNoteMenuActionClick("rename", noteMenu.noteId)
                }
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onTouchEnd={(event) =>
                  handleNoteMenuActionTouchEnd(event, "pin", noteMenu.noteId)
                }
                onClick={() =>
                  handleNoteMenuActionClick("pin", noteMenu.noteId)
                }
              >
                {noteMenuTarget?.is_pinned ? "Unpin" : "Pin"}
              </button>
              <button
                type="button"
                role="menuitem"
                onTouchEnd={(event) =>
                  handleNoteMenuActionTouchEnd(event, "lock", noteMenu.noteId)
                }
                onClick={() =>
                  handleNoteMenuActionClick("lock", noteMenu.noteId)
                }
              >
                {noteMenuTargetIsLocked ? "Remove lock" : "Lock"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="note-context-delete"
                aria-label="Delete note"
                title="Delete note"
                onTouchEnd={(event) =>
                  handleNoteMenuActionTouchEnd(event, "delete", noteMenu.noteId)
                }
                onClick={() =>
                  handleNoteMenuActionClick("delete", noteMenu.noteId)
                }
              >
                <TrashIcon />
              </button>
            </div>
          ) : null}
          {renamingNoteId ? (
            <div
              className="rename-dialog-backdrop"
              onClick={() => setRenamingNoteId(null)}
            >
              <form
                className={`rename-dialog ${themeClassName}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="rename-dialog-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleRename(renamingNoteId, renameValue);
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="rename-dialog-title">Rename note</h2>
                <label htmlFor="rename-note-input">Note title</label>
                <input
                  id="rename-note-input"
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  maxLength={200}
                />
                <div className="rename-dialog-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setRenamingNoteId(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="primary-button">
                    Save
                  </button>
                </div>
              </form>
            </div>
          ) : null}
          {noteLockAction ? (
            <div
              className="rename-dialog-backdrop"
              onClick={() => setNoteLockAction(null)}
            >
              <form
                className={`rename-dialog ${themeClassName}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="note-lock-action-title"
                onSubmit={(event) => void handleNoteLockActionSubmit(event)}
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="note-lock-action-title">
                  {noteLockAction.mode === "lock"
                    ? "Lock note"
                    : noteLockAction.mode === "remove-lock"
                      ? "Remove note lock"
                      : "Unlock note"}
                </h2>
                <label htmlFor="note-lock-action-password">
                  Note lock password
                </label>
                <input
                  id="note-lock-action-password"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={noteLockActionPassword}
                  onChange={(event) =>
                    setNoteLockActionPassword(event.target.value)
                  }
                />
                {noteLockActionError ? (
                  <p className="app-error" role="alert">
                    {noteLockActionError}
                  </p>
                ) : null}
                <div className="rename-dialog-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setNoteLockAction(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="primary-button">
                    {noteLockAction.mode === "lock"
                      ? "Lock note"
                      : noteLockAction.mode === "remove-lock"
                        ? "Remove lock"
                        : "Unlock note"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
          {noteLockDialogMode ? (
            <div
              className="rename-dialog-backdrop"
              onClick={() => setNoteLockDialogMode(null)}
            >
              <form
                className={`rename-dialog ${themeClassName}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="note-lock-dialog-title"
                onSubmit={(event) => void handleNoteLockSettingsSubmit(event)}
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="note-lock-dialog-title">
                  {noteLockDialogMode === "create"
                    ? "Set note lock password"
                    : noteLockDialogMode === "change"
                      ? "Change note lock password"
                      : "Recover note lock password"}
                </h2>
                {noteLockDialogMode === "change" ||
                (noteLockDialogMode === "recover" &&
                  !noteLockRecoveryVerified) ? (
                  <label htmlFor="note-lock-old-password">
                    {noteLockDialogMode === "recover"
                      ? "Login password"
                      : "Old note lock password"}
                  </label>
                ) : null}
                {noteLockDialogMode === "change" ||
                (noteLockDialogMode === "recover" &&
                  !noteLockRecoveryVerified) ? (
                  <input
                    id="note-lock-old-password"
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    value={noteLockOldPassword}
                    onChange={(event) =>
                      setNoteLockOldPassword(event.target.value)
                    }
                  />
                ) : null}
                {noteLockDialogMode !== "recover" ||
                noteLockRecoveryVerified ? (
                  <>
                    <label htmlFor="note-lock-new-password">
                      New note lock password
                    </label>
                    <input
                      id="note-lock-new-password"
                      type="password"
                      autoFocus={
                        noteLockDialogMode === "create" ||
                        noteLockRecoveryVerified
                      }
                      autoComplete="new-password"
                      minLength={8}
                      value={noteLockNewPassword}
                      onChange={(event) =>
                        setNoteLockNewPassword(event.target.value)
                      }
                    />
                    <label htmlFor="note-lock-confirm-password">
                      Confirm new password
                    </label>
                    <input
                      id="note-lock-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={noteLockConfirmPassword}
                      onChange={(event) =>
                        setNoteLockConfirmPassword(event.target.value)
                      }
                    />
                  </>
                ) : null}
                {noteLockDialogError ? (
                  <p className="app-error" role="alert">
                    {noteLockDialogError}
                  </p>
                ) : null}
                <div className="rename-dialog-actions">
                  {noteLockDialogMode === "change" ? (
                    <button
                      type="button"
                      className="secondary-button note-lock-forgot"
                      onClick={() => {
                        setNoteLockOldPassword("");
                        setNoteLockRecoveryVerified(false);
                        setNoteLockDialogMode("recover");
                        setNoteLockDialogError(null);
                      }}
                    >
                      Forgot password?
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={noteLockSaving}
                    onClick={() => setNoteLockDialogMode(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={noteLockSaving}
                  >
                    {noteLockSaving
                      ? "Please wait..."
                      : noteLockDialogMode === "recover" &&
                          !noteLockRecoveryVerified
                        ? "Verify login password"
                        : "Save password"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
          <button
            type="button"
            className={`mobile-new-note ${themeClassName} ${selectedNote ? "is-hidden" : ""}`}
            onTouchEnd={handleNewNoteTouchEnd}
            onClick={handleNewNoteClick}
            aria-label="Create a new note"
            title="Create a new note"
          >
            +
          </button>
        </>,
        document.body,
      )}
    </>
  );
}

export default App;
