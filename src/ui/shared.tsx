import {
  useEffect,
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  Upload,
  Battery,
  BatteryCharging,
  Check,
  X,
  CircleAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Progress,
  Select,
  Slider,
  Switch,
} from "./index";
import type { KeyboardBattery, TransferProgress } from "../types";

export const EditingLock = createContext(false);

export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`studio-card ${className}`}>
      <CardHeader>
        <div className="panel-title">
          <CardTitle>{title}</CardTitle>
          {action}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </fieldset>
  );
}
export function Choice({
  label,
  value,
  onChange,
  options,
  disabled,
  searchable = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: Array<{ value: string | number; label: string }>;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const locked = useContext(EditingLock) || disabled;
  return (
    <Field label={label}>
      <Select
        value={String(value)}
        aria-label={label}
        onChange={(e) => {
          if (!locked) onChange(e.target.value);
        }}
        options={options.map((o) => ({ ...o, value: String(o.value) }))}
        disabled={locked}
        searchable={searchable}
      />
    </Field>
  );
}
export function Range({
  label,
  value,
  onChange,
  max = 5,
  min = 0,
  disabled,
  onChangeEnd,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChangeEnd?: (v: number) => void;
}) {
  const locked = useContext(EditingLock) || disabled;
  return (
    <Field label={label}>
      <div className="range-row">
        <Slider
          value={value}
          aria-label={label}
          min={min}
          max={max}
          step={1}
          onChange={(v) => {
            if (!locked) onChange(v);
          }}
          onChangeEnd={(v) => {
            if (!locked) onChangeEnd?.(v);
          }}
          disabled={locked}
        />
        <span>
          {value}
          <small> / {max}</small>
        </span>
      </div>
    </Field>
  );
}
export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        {description && <p>{description}</p>}
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        aria-label={label}
        disabled={disabled}
      />
    </div>
  );
}
export function ColorPicker({
  value,
  onChange,
  colors,
  label = "Cor principal",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: string[];
  label?: string;
  disabled?: boolean;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => {
    setHex(value);
  }, [value]);
  return (
    <Field label={label}>
      <div className="color-inputs">
        <Input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="color-well"
          wrapperClassName="color-well-wrap"
          disabled={disabled}
        />
        <Input
          aria-label={`${label} em hexadecimal`}
          value={hex.toUpperCase()}
          maxLength={7}
          onChange={(e) => {
            setHex(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value))
              onChange(e.target.value);
          }}
          onBlur={() => setHex(value)}
          leftIcon={<span className="muted">HEX</span>}
          disabled={disabled}
        />
      </div>
      <div className="swatches">
        {colors.map((c) => (
          <Button
            key={c}
            variant="ghost"
            iconOnly
            size="sm"
            className="swatch"
            style={{ "--swatch": c } as CSSProperties}
            aria-label={`Usar cor ${c}`}
            aria-pressed={value.toLowerCase() === c.toLowerCase()}
            onClick={() => onChange(c)}
            disabled={disabled}
          >
            {value.toLowerCase() === c.toLowerCase() && <Check size={15} />}
          </Button>
        ))}
      </div>
    </Field>
  );
}
export function FileButton({
  children,
  accept,
  onChange,
  disabled,
  variant = "default",
}: {
  children: ReactNode;
  accept: string;
  onChange: (event: Event) => unknown;
  disabled?: boolean;
  variant?: "default" | "primary" | "ghost";
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant={variant}
        leftIcon={<Upload size={15} />}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {children}
      </Button>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept={accept}
        tabIndex={-1}
        onChange={(e) => {
          void onChange(e.nativeEvent);
        }}
        disabled={disabled}
      />
    </>
  );
}
export function BatteryStatus({
  battery,
  compact = false,
}: {
  battery: KeyboardBattery | null;
  compact?: boolean;
}) {
  const valid =
    battery?.percent != null &&
    Number.isInteger(battery.percent) &&
    battery.percent >= 0 &&
    battery.percent <= 100;
  const stale =
    valid &&
    battery?.updatedAt != null &&
    Date.now() - battery.updatedAt > 60000;
  const Icon = battery?.charging === true ? BatteryCharging : Battery;
  return (
    <span
      className={`battery-status ${compact ? "compact" : ""}`}
      title={battery?.message ?? "Consultando bateria do teclado…"}
    >
      <Icon size={16} />
      <span>
        {valid
          ? `${stale ? "~" : ""}${battery!.percent}%`
          : compact
            ? "—"
            : "Nível indisponível"}
      </span>
      {!compact && (
        <small>
          {stale
            ? "Última leitura"
            : battery?.source === "bluetooth"
              ? "Bluetooth"
              : battery?.source === "2.4g"
                ? "Receptor 2,4 GHz"
                : battery?.charging
                  ? "Carregando"
                  : "Bateria do teclado"}
        </small>
      )}
    </span>
  );
}
export function Transfer({
  progress,
  busy,
  outcome,
  percent,
  cancel,
  canCancel,
}: {
  progress: TransferProgress;
  busy: boolean;
  outcome: string;
  percent: number;
  cancel: () => unknown;
  canCancel: boolean;
}) {
  return (
    <Card
      className={`transfer studio-card ${outcome}`}
      role="status"
      aria-live="polite"
    >
      <div className="spread">
        <span className="inline-icon">
          {outcome === "success" ? (
            <Check size={16} />
          ) : outcome === "error" ? (
            <CircleAlert size={16} />
          ) : null}
          {progress.message}
        </span>
        <span>
          {progress.stage === "live" ? (
            <Badge variant="info">Ao vivo</Badge>
          ) : (
            `${percent}%`
          )}
        </span>
      </div>
      <Progress
        value={percent}
        indeterminate={progress.stage === "live"}
        variant={
          outcome === "error"
            ? "danger"
            : outcome === "success"
              ? "success"
              : "default"
        }
        size="sm"
      />
      <div className="spread">
        <small className="muted">
          {outcome === "error"
            ? "A operação não foi concluída."
            : busy
              ? "Mantenha o cabo USB conectado."
              : "Comandos confirmados pelo teclado."}
        </small>
        {canCancel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void cancel();
            }}
          >
            {progress.stage === "live" ? "Parar efeito" : "Cancelar envio"}
          </Button>
        )}
      </div>
    </Card>
  );
}
export function Notice({
  children,
  error = false,
  dismiss,
}: {
  children: ReactNode;
  error?: boolean;
  dismiss?: () => void;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <CircleAlert size={16} />
      <div>{children}</div>
      {dismiss && (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          aria-label="Fechar aviso"
          onClick={dismiss}
        >
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
