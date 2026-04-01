interface HealthIndicatorProps {
  health: string;
  size?: "sm" | "md" | "lg";
}

const healthConfig: Record<
  string,
  { color: string; pulse: string; label: string }
> = {
  healthy: {
    color: "bg-success",
    pulse: "pulse-healthy",
    label: "Healthy",
  },
  warning: {
    color: "bg-amber",
    pulse: "pulse-warning",
    label: "Warning",
  },
  blocked: {
    color: "bg-danger",
    pulse: "pulse-blocked",
    label: "Blocked",
  },
  idle: {
    color: "bg-space-500",
    pulse: "",
    label: "Idle",
  },
};

const sizes = {
  sm: "w-2 h-2",
  md: "w-3 h-3",
  lg: "w-4 h-4",
};

export function HealthIndicator({
  health,
  size = "md",
}: HealthIndicatorProps) {
  const config = healthConfig[health] || healthConfig.idle;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`rounded-full ${config.color} ${config.pulse} ${sizes[size]}`}
        title={config.label}
      />
    </div>
  );
}
