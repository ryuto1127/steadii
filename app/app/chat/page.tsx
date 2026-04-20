import { redirect } from "next/navigation";

export default function ChatIndexRedirect() {
  redirect("/app/chats");
}
