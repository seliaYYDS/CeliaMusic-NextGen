import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import "./components.css";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type UIButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  iconOnly?: boolean;
};

const buttonSizeClassName: Record<ButtonSize, string> = {
  sm: "ui-button--sm",
  md: "",
  lg: "ui-button--lg",
};

export function UIButton({
  variant = "secondary",
  size = "md",
  leadingIcon,
  iconOnly = false,
  className = "",
  children,
  type = "button",
  ...props
}: UIButtonProps) {
  const composedClassName = [
    "ui-button",
    `ui-button--${variant}`,
    buttonSizeClassName[size],
    iconOnly ? "ui-button--icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={composedClassName} type={type} {...props}>
      {leadingIcon}
      {children}
    </button>
  );
}

type UIPaginationProps = {
  currentPage: number;
  totalPages: number;
  pageLabel: string;
  firstPageLabel: string;
  previousPageLabel: string;
  nextPageLabel: string;
  lastPageLabel: string;
  className?: string;
  onPageChange: (page: number) => void;
};

export function UIPagination({
  currentPage,
  totalPages,
  pageLabel,
  firstPageLabel,
  previousPageLabel,
  nextPageLabel,
  lastPageLabel,
  className = "",
  onPageChange,
}: UIPaginationProps) {
  const resolvedTotalPages = Math.max(1, Math.floor(totalPages) || 1);
  const resolvedCurrentPage = Math.min(
    resolvedTotalPages,
    Math.max(1, Math.floor(currentPage) || 1),
  );
  const [pageInput, setPageInput] = useState(String(resolvedCurrentPage));

  useEffect(() => {
    setPageInput(String(resolvedCurrentPage));
  }, [resolvedCurrentPage]);

  const commitPageInput = () => {
    const parsedPage = Number(pageInput.trim());
    if (!Number.isFinite(parsedPage)) {
      setPageInput(String(resolvedCurrentPage));
      return;
    }

    const nextPage = Math.min(
      resolvedTotalPages,
      Math.max(1, Math.round(parsedPage)),
    );
    setPageInput(String(nextPage));

    if (nextPage !== resolvedCurrentPage) {
      onPageChange(nextPage);
    }
  };

  return (
    <div className={["playlist-pagination", className].filter(Boolean).join(" ")}>
      <UIButton
        variant="secondary"
        size="sm"
        iconOnly
        className="playlist-pagination__nav playlist-pagination__nav--first"
        aria-label={firstPageLabel}
        onClick={() => onPageChange(1)}
        disabled={resolvedCurrentPage <= 1}
      >
        <ChevronsLeftIcon />
      </UIButton>
      <UIButton
        variant="secondary"
        size="sm"
        iconOnly
        className="playlist-pagination__nav playlist-pagination__nav--previous"
        aria-label={previousPageLabel}
        onClick={() => onPageChange(Math.max(1, resolvedCurrentPage - 1))}
        disabled={resolvedCurrentPage <= 1}
      >
        <ChevronLeftIcon />
      </UIButton>
      <div className="playlist-pagination__summary">
        <span className="playlist-pagination__text">{pageLabel}</span>
        <label className="playlist-pagination__input-shell">
          <input
            className="playlist-pagination__input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={pageLabel}
            value={pageInput}
            onChange={(event) => {
              const nextValue = event.target.value.replace(/[^\d]/g, "");
              setPageInput(nextValue);
            }}
            onBlur={commitPageInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitPageInput();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setPageInput(String(resolvedCurrentPage));
              }
            }}
          />
        </label>
        <span className="playlist-pagination__divider">/ {resolvedTotalPages}</span>
      </div>
      <UIButton
        variant="secondary"
        size="sm"
        iconOnly
        className="playlist-pagination__nav playlist-pagination__nav--next"
        aria-label={nextPageLabel}
        onClick={() => onPageChange(Math.min(resolvedTotalPages, resolvedCurrentPage + 1))}
        disabled={resolvedCurrentPage >= resolvedTotalPages}
      >
        <ChevronRightIcon />
      </UIButton>
      <UIButton
        variant="secondary"
        size="sm"
        iconOnly
        className="playlist-pagination__nav playlist-pagination__nav--last"
        aria-label={lastPageLabel}
        onClick={() => onPageChange(resolvedTotalPages)}
        disabled={resolvedCurrentPage >= resolvedTotalPages}
      >
        <ChevronsRightIcon />
      </UIButton>
    </div>
  );
}

type UITextFieldProps = {
  label: string;
  placeholder?: string;
  helper?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  value: string;
  onChange: (value: string) => void;
};

export function UITextField({
  label,
  placeholder,
  helper,
  prefix,
  suffix,
  value,
  onChange,
}: UITextFieldProps) {
  return (
    <label className="ui-field">
      <span className="ui-field__label">{label}</span>
      <span className="ui-input-shell">
        {prefix ? <span className="ui-input-shell__prefix">{prefix}</span> : null}
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <span className="ui-input-shell__suffix">{suffix}</span> : null}
      </span>
      {helper ? <span className="ui-field__helper">{helper}</span> : null}
    </label>
  );
}

export type UISelectOption = {
  label: string;
  value: string;
  description?: string;
  labelStyle?: CSSProperties;
};

type UISelectProps = {
  label: string;
  helper?: string;
  options: UISelectOption[];
  value: string;
  onChange: (value: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyStateLabel?: string;
};

export function UISelect({
  label,
  helper,
  options,
  value,
  onChange,
  searchable = false,
  searchPlaceholder,
  emptyStateLabel,
}: UISelectProps) {
  const [menuState, setMenuState] = useState<"closed" | "opening" | "open" | "closing">("closed");
  const [searchQuery, setSearchQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeOption = options.find((option) => option.value === value) ?? options[0];
  const isOpen = menuState === "opening" || menuState === "open";
  const isRendered = menuState !== "closed";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!searchable || !normalizedSearchQuery) {
      return options;
    }

    return options.filter((option) => {
      const haystacks = [option.label, option.value, option.description ?? ""];
      return haystacks.some((item) => item.toLowerCase().includes(normalizedSearchQuery));
    });
  }, [normalizedSearchQuery, options, searchable]);

  useEffect(() => {
    let closeTimer: number | undefined;

    if (menuState === "opening") {
      closeTimer = window.setTimeout(() => {
        setMenuState("open");
      }, 16);
    }

    if (menuState === "closing") {
      closeTimer = window.setTimeout(() => {
        setMenuState("closed");
      }, 160);
    }

    return () => {
      if (closeTimer) {
        window.clearTimeout(closeTimer);
      }
    };
  }, [menuState]);

  useEffect(() => {
    if (menuState === "closed") {
      setSearchQuery("");
    }
  }, [menuState]);

  useEffect(() => {
    if (!searchable || !isOpen) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 24);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isOpen, searchable]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuState((current) => {
          if (current === "closed" || current === "closing") {
            return current;
          }

          return "closing";
        });
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  return (
    <div className="ui-field">
      <span className="ui-field__label">{label}</span>
      <div
        className={["ui-select", isOpen ? "ui-select--open" : ""].filter(Boolean).join(" ")}
        ref={rootRef}
      >
        <button
          className="ui-select__trigger"
          type="button"
          aria-expanded={isOpen}
          onClick={() =>
            setMenuState((current) => {
              if (current === "closed") {
                return "opening";
              }

              if (current === "closing") {
                return "opening";
              }

              return "closing";
            })
          }
        >
          <span className="ui-select__value" style={activeOption.labelStyle}>
            {activeOption.label}
          </span>
          <ChevronDownIcon className="ui-select__caret" />
        </button>

        {isRendered ? (
          <div
            className={[
              "ui-select__menu",
              menuState === "opening" || menuState === "open" ? "ui-select__menu--open" : "",
              menuState === "closing" ? "ui-select__menu--closing" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="listbox"
            aria-label={label}
          >
            {searchable ? (
              <div className="ui-select__search">
                <SearchIcon className="ui-select__search-icon" />
                <input
                  ref={searchInputRef}
                  className="ui-select__search-input"
                  type="text"
                  value={searchQuery}
                  placeholder={searchPlaceholder}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                  }}
                />
              </div>
            ) : null}
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  className={[
                    "ui-select__menu-item",
                    option.value === value ? "ui-select__menu-item--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setMenuState("closing");
                  }}
                >
                  <strong style={option.labelStyle}>{option.label}</strong>
                  {option.description ? <span>{option.description}</span> : null}
                </button>
              ))
            ) : (
              <div className="ui-select__empty">{emptyStateLabel ?? "No matching options"}</div>
            )}
          </div>
        ) : null}
      </div>
      {helper ? <span className="ui-field__helper">{helper}</span> : null}
    </div>
  );
}

type UISliderProps = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  valueSuffix?: string;
  onChange: (value: number) => void;
};

export function UISlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  valueSuffix = "%",
  onChange,
}: UISliderProps) {
  const [isActive, setIsActive] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const range = Math.max(max - min, 0);
  const ratio = range === 0 ? 0 : Math.min(1, Math.max(0, (value - min) / range));
  const displayRatio = dragRatio ?? ratio;

  const updateValueFromPosition = (clientX: number) => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    const rect = track.getBoundingClientRect();
    const rawRatio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
    const clampedRatio = Math.min(1, Math.max(0, rawRatio));
    setDragRatio(clampedRatio);
    const snappedValue =
      min + Math.round(((clampedRatio * range) / Math.max(step, 0.0001))) * Math.max(step, 0.0001);
    const nextValue = Math.min(max, Math.max(min, snappedValue));

    onChange(Number(nextValue.toFixed(4)));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsActive(true);
    updateValueFromPosition(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }

    updateValueFromPosition(event.clientX);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsActive(false);
    setDragRatio(null);
  };

  return (
    <label
      className={["ui-slider", isActive ? "ui-slider--active" : ""].filter(Boolean).join(" ")}
      style={
        {
          "--slider-ratio": displayRatio,
        } as CSSProperties
      }
    >
      <span className="ui-slider__topline">
        <span className="ui-field__label">{label}</span>
        <span className="ui-slider__value">
          {value}
          {valueSuffix}
        </span>
      </span>
      <span
        ref={trackRef}
        className="ui-slider__track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={() => {
          setIsActive(false);
          setDragRatio(null);
        }}
      >
        <span className="ui-slider__rail">
          <span className="ui-slider__fill" />
        </span>
        <span className="ui-slider__thumb-glow" />
        <span className="ui-slider__thumb" aria-hidden="true" />
        <input className="ui-slider__input" type="range" min={min} max={max} step={step} value={value} readOnly />
      </span>
    </label>
  );
}

type UICheckboxProps = {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function UICheckbox({
  label,
  description,
  checked,
  onChange,
}: UICheckboxProps) {
  return (
    <div className={["ui-check", checked ? "ui-check--checked" : ""].filter(Boolean).join(" ")}>
      <div className="ui-check__text">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <button
        className="ui-check__box"
        type="button"
        aria-pressed={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <CheckIcon />
      </button>
    </div>
  );
}

type UISwitchProps = {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function UISwitch({
  label,
  description,
  checked,
  onChange,
}: UISwitchProps) {
  const [isActive, setIsActive] = useState(false);

  return (
    <div
      className={[
        "ui-switch",
        checked ? "ui-switch--checked" : "",
        isActive ? "ui-switch--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="ui-switch__text">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <button
        className="ui-switch__track"
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onPointerDown={() => setIsActive(true)}
        onPointerUp={() => setIsActive(false)}
        onPointerCancel={() => setIsActive(false)}
        onBlur={() => setIsActive(false)}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

type UILoadingBlockProps = {
  label: string;
  variant?: "inline" | "list" | "grid";
  items?: number;
};

export function UILoadingBlock({
  label,
  variant = "list",
  items = variant === "grid" ? 6 : 4,
}: UILoadingBlockProps) {
  return (
    <div className={["ui-loading", `ui-loading--${variant}`].join(" ")}>
      <div className="ui-loading__label">
        <span className="ui-loading__spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>

      {variant !== "inline" ? (
        <div className="ui-loading__skeletons" aria-hidden="true">
          {Array.from({ length: items }, (_, index) => (
            <span key={`${variant}-${index}`} className="ui-loading__skeleton" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SearchIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3 3" />
    </svg>
  );
}

export function PlusIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M8 3.5v9" />
      <path d="M3.5 8h9" />
    </svg>
  );
}

export function PlayIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M5.5 4.5l6 3.5-6 3.5z" />
    </svg>
  );
}

export function MoreIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <circle cx="3.5" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.5" cy="8" r="1" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M4.5 6.5L8 10l3.5-3.5" />
    </svg>
  );
}

export function CheckIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M3.5 8.5l2.5 2.5 6-6" />
    </svg>
  );
}

function ChevronLeftIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M9.5 3.5L5 8l4.5 4.5" />
    </svg>
  );
}

function ChevronRightIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M6.5 3.5L11 8l-4.5 4.5" />
    </svg>
  );
}

function ChevronsLeftIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M10.5 3.5L6 8l4.5 4.5" />
      <path d="M7.5 3.5L3 8l4.5 4.5" />
    </svg>
  );
}

function ChevronsRightIcon({ className = "ui-icon" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M5.5 3.5L10 8l-4.5 4.5" />
      <path d="M8.5 3.5L13 8l-4.5 4.5" />
    </svg>
  );
}
