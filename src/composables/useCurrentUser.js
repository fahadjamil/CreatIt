import { computed, ref } from "vue";
import { getCurrentUser } from "@/lib/api";
import { currentUserProfile, normalizeUserPayload, setStoredUserProfile, } from "@/lib/userProfile";
import { useInitials } from "@/composables/useInitials";
export function useCurrentUser() {
    const loading = ref(false);
    const displayLabel = computed(() => {
        const p = currentUserProfile.value;
        if (!p)
            return "";
        return ((p.name && p.name.trim()) ||
            [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
            p.email?.trim() ||
            "");
    });
    const initials = computed(() => useInitials(displayLabel.value || currentUserProfile.value?.email || "?"));
    async function refresh() {
        loading.value = true;
        try {
            const res = await getCurrentUser();
            const u = normalizeUserPayload(res.data);
            if (u)
                setStoredUserProfile(u);
        }
        catch {
            // Keep login snapshot or empty; avoid clearing profile on 404/network errors.
        }
        finally {
            loading.value = false;
        }
    }
    return {
        profile: currentUserProfile,
        displayLabel,
        initials,
        loading,
        refresh,
    };
}
