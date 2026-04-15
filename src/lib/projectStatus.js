const LABELS = {
    signed: "Signed",
    in_progress: "In Progress",
    completed: "Completed",
    delayed: "Delayed",
    in_dispute: "In Dispute",
    payment_due: "Payment Due",
    draft: "Draft",
    discussion: "Discussion",
};
/**
 * Best-effort normalization from API/backfill data.
 * Accepts snake_case, kebab-case, and partial phrases.
 */
export function normalizeProjectStatus(raw) {
    const value = String(raw ?? "")
        .trim()
        .toLowerCase();
    if (!value)
        return "draft";
    // Prefer explicit matches first.
    if (value.includes("payment") && (value.includes("due") || value.includes("overdue")))
        return "payment_due";
    if (value.includes("dispute"))
        return "in_dispute";
    if (value.includes("delay"))
        return "delayed";
    if (value.includes("complete"))
        return "completed";
    if (value.includes("discussion"))
        return "discussion";
    if (value.includes("in_progress") || value.includes("in-progress") || value.includes("in progress"))
        return "in_progress";
    if (value.includes("draft"))
        return "draft";
    if (value.includes("signed"))
        return "signed";
    // If the API already returns one of our canonical statuses, keep it.
    const canonical = value.replace(/-/g, "_");
    if (canonical in LABELS)
        return canonical;
    return "draft";
}
export function projectStatusLabel(raw) {
    return LABELS[normalizeProjectStatus(raw)];
}
/**
 * Used for CSS class / data-variant.
 * Keep it snake_case so it matches API payloads.
 */
export function projectStatusVariant(raw) {
    return normalizeProjectStatus(raw);
}
