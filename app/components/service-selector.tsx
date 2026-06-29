import { InfoIcon } from "lucide-react";
import { type GoogleService, SERVICE_LABELS } from "@/lib/api";

const ALL_SERVICES = Object.entries(SERVICE_LABELS) as [
	GoogleService,
	string,
][];

type ServiceSelectorProps = {
	value: Set<GoogleService>;
	onToggle: (id: GoogleService) => void;
	/**
	 * Services that cannot be selected, mapped to the reason shown in a tooltip
	 * next to an info icon (e.g. required server secrets are missing).
	 */
	disabledServices?: Partial<Record<GoogleService, string>>;
};

export function ServiceSelector({
	value,
	onToggle,
	disabledServices,
}: ServiceSelectorProps) {
	return (
		<div className="grid grid-cols-2 gap-2 pt-1">
			{ALL_SERVICES.map(([id, label]) => {
				const reason = disabledServices?.[id];
				const disabled = reason !== undefined;
				return (
					<label
						key={id}
						className={`flex items-center gap-2 text-sm ${
							disabled
								? "cursor-not-allowed text-muted-foreground"
								: "cursor-pointer"
						}`}
					>
						<input
							type="checkbox"
							className="h-4 w-4 accent-primary"
							checked={value.has(id)}
							disabled={disabled}
							onChange={() => onToggle(id)}
						/>
						{label}
						{disabled && (
							<span title={reason} className="inline-flex">
								<InfoIcon
									className="size-3.5 text-muted-foreground"
									aria-label={reason}
								/>
							</span>
						)}
					</label>
				);
			})}
		</div>
	);
}
