import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Recover" };

export default function Page() {
    return (
        <Suspense>
            <AuthForm mode="recover" />
        </Suspense>
    );
}
