import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";

/** Extensions communes à l'éditeur et à la conversion texte (versions, IA). */
export const noteExtensions = (placeholder = "Écris, colle, structure… Tape « / » pour mettre en forme.") => [
  StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] } }),
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ allowBase64: false }),
  Placeholder.configure({ placeholder }),
];
