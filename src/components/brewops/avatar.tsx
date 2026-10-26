"use client";

// Avatar — the user's photo wherever their name shows (topbar, sidebar, profile,
// team roster). Falls back to initials when no photo is uploaded yet.
export function Avatar({
  name,
  avatarUrl,
  className = "h-9 w-9 text-[11px]",
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  if (avatarUrl) {
    return (
       
      <img
        src={avatarUrl}
        alt={`${name} profile photo`}
        className={`${className} rounded-full object-cover border border-primary/30 bg-primary/10`}
      />
    );
  }
  return (
    <span
      className={`${className} rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-bold text-primary shrink-0`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
