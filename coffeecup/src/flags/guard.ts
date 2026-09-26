import { FeatureDisabledError } from "@/lib/errors";
import { isFlagEnabled, type FlagName } from "./index";

/** Throw (404 at the HTTP layer) unless the flag is on. Use in services AND routes. */
export function requireFlag(name: FlagName): void {
    if (!isFlagEnabled(name)) throw new FeatureDisabledError(name);
}
