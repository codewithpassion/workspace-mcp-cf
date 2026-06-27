import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-in")({
	component: SignInPage,
});

function SignInPage() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-6">
			<SignIn routing="hash" fallbackRedirectUrl="/app/configs" />
		</div>
	);
}
