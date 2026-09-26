import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Reset" };

export default function Page() {
    return (
        <Suspense>
            <AuthForm mode="reset" />
        </Suspense>
    );
}
