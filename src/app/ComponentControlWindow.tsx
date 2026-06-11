import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  UISelect,
  UISlider,
  UISwitch,
  UITextField,
  type UISelectOption,
} from "../ui/components";
import {
  COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL,
  openComponentDynamicIslandWindow,
  readComponentDynamicIslandSettings,
  writeComponentDynamicIslandSettings,
  emitComponentDynamicIslandSettings,
  type ComponentDynamicIslandColorMode,
  type ComponentDynamicIslandDefaultContentMode,
  type ComponentDynamicIslandDesign,
  type ComponentDynamicIslandSettings,
} from "./componentDynamicIslandSync";
import "./styles.css";
import "./component-windows.css";

type ComponentControlPage = "list" | "dynamic-island";

const COMPONENT_HUB_COPY = {
  title: "组件控制窗口",
  sectionTitle: "组件列表",
  backLabel: "返回",
  dynamicIslandTitle: "灵动岛",
  dynamicIslandDescription: "开启一个独立的全局灵动岛组件，用于显示播放信息或待机内容。",
  dynamicIslandEnabled: "开启灵动岛",
  dynamicIslandAlwaysOnTop: "灵动岛置顶",
  dynamicIslandHideOnMouseNearby: "鼠标靠近隐藏",
  dynamicIslandHideWhenMainWindowVisible: "主窗口显示时隐藏",
  dynamicIslandHideWhenOtherAppsFullscreen: "其他应用全屏时隐藏",
  dynamicIslandHideWhenIdle: "无播放时隐藏",
  dynamicIslandScale: "灵动岛缩放",
  dynamicIslandDesign: "灵动岛设计",
  dynamicIslandColorMode: "灵动岛配色",
  dynamicIslandDefaultContent: "默认显示内容",
  dynamicIslandDefaultCustomText: "自定义文字",
  dynamicIslandDefaultCustomFormat: "自定义格式",
  dynamicIslandDefaultCustomFormatHelper:
    "支持 yyyy mm dd hh MM ss，例如：今天是yyyy年mm月dd日",
  cards: [
    { id: "dynamic-island", title: "灵动岛" },
    { id: "playback-info", title: "播放信息卡片" },
    { id: "lyrics-display", title: "歌词显示" },
  ],
  designOptions: [
    { value: "separated", label: "分离式" },
    { value: "integrated", label: "一体式" },
  ] satisfies UISelectOption[],
  colorOptions: [
    { value: "follow-app", label: "跟随应用配色" },
    { value: "light", label: "亮色" },
    { value: "dark", label: "暗色" },
    { value: "follow-system", label: "跟随系统" },
  ] satisfies UISelectOption[],
  defaultContentOptions: [
    { value: "time", label: "时间" },
    { value: "date", label: "日期" },
    { value: "custom-text", label: "自定义文字" },
    { value: "custom-format", label: "自定义格式" },
  ] satisfies UISelectOption[],
} as const;

export function ComponentControlWindow() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [isMaximized, setIsMaximized] = useState(false);
  const [page, setPage] = useState<ComponentControlPage>("list");
  const [dynamicIslandSettings, setDynamicIslandSettings] = useState<ComponentDynamicIslandSettings>(
    () => readComponentDynamicIslandSettings(),
  );

  useEffect(() => {
    void currentWindow
      .isMaximized()
      .then((value) => {
        setIsMaximized(value);
      })
      .catch(() => undefined);
  }, [currentWindow]);

  const persistDynamicIslandSettings = async (nextSettings: ComponentDynamicIslandSettings) => {
    setDynamicIslandSettings(nextSettings);
    writeComponentDynamicIslandSettings(nextSettings);
    const islandWindow = await WebviewWindow.getByLabel(COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL).catch(
      () => null,
    );

    if (nextSettings.enabled) {
      if (!islandWindow) {
        await openComponentDynamicIslandWindow().catch(() => undefined);
      }
      await emitComponentDynamicIslandSettings(nextSettings).catch(() => undefined);
      return;
    }

    if (islandWindow) {
      await emitComponentDynamicIslandSettings(nextSettings).catch(() => undefined);
      await islandWindow.destroy().catch(() => undefined);
    }
  };

  const updateDynamicIslandSettings = async (patch: Partial<ComponentDynamicIslandSettings>) => {
    const nextSettings = {
      ...dynamicIslandSettings,
      ...patch,
    };

    await persistDynamicIslandSettings(nextSettings);
  };

  const handleToggleMaximize = async () => {
    await currentWindow.toggleMaximize();
    setIsMaximized(await currentWindow.isMaximized());
  };

  const handleStartDragging = async (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || isMaximized) {
      return;
    }

    if (event.target instanceof HTMLElement && event.target.closest(".window-controls")) {
      return;
    }

    await currentWindow.startDragging();
  };

  return (
    <div className="component-control-window">
      <div className="component-control-window__surface">
        <header
          className="component-control-window__titlebar"
          onMouseDown={(event) => {
            void handleStartDragging(event);
          }}
          onDoubleClick={(event) => {
            if (event.target instanceof HTMLElement && event.target.closest(".window-controls")) {
              return;
            }

            void handleToggleMaximize();
          }}
        >
          <div className="component-control-window__drag">
            <div className="component-control-window__heading">
              <h1 className="component-control-window__title">{COMPONENT_HUB_COPY.title}</h1>
            </div>
          </div>
          <div className="window-controls" aria-label="Window Controls">
            <button
              className="window-controls__button window-controls__button--minimize"
              type="button"
              aria-label="Minimize Window"
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void currentWindow.minimize();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path className="chrome-icon__minimize-line" d="M4 8.5h8" />
              </svg>
            </button>
            <button
              className={[
                "window-controls__button",
                "window-controls__button--maximize",
                isMaximized ? "window-controls__button--maximize-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              aria-label={isMaximized ? "Restore Window" : "Maximize Window"}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void handleToggleMaximize();
              }}
            >
              {isMaximized ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__restore-back" d="M6 4.75h5.25V10" />
                  <path className="chrome-icon__restore-front" d="M4.75 6h5.25v5.25H4.75z" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__maximize-frame" d="M4 4h8v8H4z" />
                  <path className="chrome-icon__maximize-top" d="M4 5.35h8" />
                </svg>
              )}
            </button>
            <button
              className="window-controls__button window-controls__button--close"
              type="button"
              aria-label="Close Window"
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void currentWindow.close();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path className="chrome-icon__close-line chrome-icon__close-line--a" d="M5 5l6 6" />
                <path className="chrome-icon__close-line chrome-icon__close-line--b" d="M11 5l-6 6" />
              </svg>
            </button>
          </div>
        </header>

        <main className="component-control-window__content">
          {page === "list" ? (
            <div className="component-control-window__panel">
              <section className="component-control-window__section">
                <div className="component-control-window__section-copy">
                  <h2>{COMPONENT_HUB_COPY.sectionTitle}</h2>
                </div>

                <div className="component-control-window__entry-grid">
                  {COMPONENT_HUB_COPY.cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="component-control-window__entry-card"
                      onClick={() => {
                        if (card.id === "dynamic-island") {
                          setPage("dynamic-island");
                        }
                      }}
                    >
                      <div className="component-control-window__card-top">
                        <div className="component-control-window__entry-copy">
                          <h3>{card.title}</h3>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {page === "dynamic-island" ? (
            <div className="component-control-window__page">
              <button
                type="button"
                className="component-control-window__back-button"
                onClick={() => setPage("list")}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M9.5 3.5 5 8l4.5 4.5" />
                </svg>
                <span>{COMPONENT_HUB_COPY.backLabel}</span>
              </button>

              <div className="component-control-window__page-section">
                <div className="component-control-window__section-copy">
                  <h2>{COMPONENT_HUB_COPY.dynamicIslandTitle}</h2>
                  <p>{COMPONENT_HUB_COPY.dynamicIslandDescription}</p>
                </div>

                <div className="component-control-window__settings-stack">
                  <UISwitch
                    label={COMPONENT_HUB_COPY.dynamicIslandEnabled}
                    checked={dynamicIslandSettings.enabled}
                    onChange={(checked) => {
                      void updateDynamicIslandSettings({ enabled: checked });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.dynamicIslandAlwaysOnTop}
                    checked={dynamicIslandSettings.alwaysOnTop}
                    onChange={(checked) => {
                      void updateDynamicIslandSettings({ alwaysOnTop: checked });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.dynamicIslandHideOnMouseNearby}
                    checked={dynamicIslandSettings.hideOnMouseNearby}
                    onChange={(checked) => {
                      void updateDynamicIslandSettings({ hideOnMouseNearby: checked });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.dynamicIslandHideWhenMainWindowVisible}
                    checked={dynamicIslandSettings.hideWhenMainWindowVisible}
                    onChange={(checked) => {
                      void updateDynamicIslandSettings({ hideWhenMainWindowVisible: checked });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.dynamicIslandHideWhenOtherAppsFullscreen}
                    checked={dynamicIslandSettings.hideWhenOtherAppsFullscreen}
                    onChange={(checked) => {
                      void updateDynamicIslandSettings({ hideWhenOtherAppsFullscreen: checked });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.dynamicIslandHideWhenIdle}
                    checked={dynamicIslandSettings.hideWhenIdle}
                    onChange={(checked) => {
                      void updateDynamicIslandSettings({ hideWhenIdle: checked });
                    }}
                  />
                  <UISlider
                    label={COMPONENT_HUB_COPY.dynamicIslandScale}
                    value={dynamicIslandSettings.scale}
                    min={70}
                    max={160}
                    step={1}
                    valueSuffix="%"
                    onChange={(value) => {
                      void updateDynamicIslandSettings({ scale: value });
                    }}
                  />
                  <UISelect
                    label={COMPONENT_HUB_COPY.dynamicIslandDesign}
                    options={COMPONENT_HUB_COPY.designOptions as UISelectOption[]}
                    value={dynamicIslandSettings.design}
                    onChange={(value) => {
                      void updateDynamicIslandSettings({
                        design: value as ComponentDynamicIslandDesign,
                      });
                    }}
                  />
                  <UISelect
                    label={COMPONENT_HUB_COPY.dynamicIslandColorMode}
                    options={COMPONENT_HUB_COPY.colorOptions as UISelectOption[]}
                    value={dynamicIslandSettings.colorMode}
                    onChange={(value) => {
                      void updateDynamicIslandSettings({
                        colorMode: value as ComponentDynamicIslandColorMode,
                      });
                    }}
                  />
                  <UISelect
                    label={COMPONENT_HUB_COPY.dynamicIslandDefaultContent}
                    options={COMPONENT_HUB_COPY.defaultContentOptions as UISelectOption[]}
                    value={dynamicIslandSettings.defaultContentMode}
                    onChange={(value) => {
                      void updateDynamicIslandSettings({
                        defaultContentMode: value as ComponentDynamicIslandDefaultContentMode,
                      });
                    }}
                  />
                  {dynamicIslandSettings.defaultContentMode === "custom-text" ? (
                    <UITextField
                      label={COMPONENT_HUB_COPY.dynamicIslandDefaultCustomText}
                      value={dynamicIslandSettings.defaultCustomText}
                      onChange={(value) => {
                        void updateDynamicIslandSettings({ defaultCustomText: value });
                      }}
                    />
                  ) : null}
                  {dynamicIslandSettings.defaultContentMode === "custom-format" ? (
                    <UITextField
                      label={COMPONENT_HUB_COPY.dynamicIslandDefaultCustomFormat}
                      helper={COMPONENT_HUB_COPY.dynamicIslandDefaultCustomFormatHelper}
                      value={dynamicIslandSettings.defaultCustomFormat}
                      onChange={(value) => {
                        void updateDynamicIslandSettings({ defaultCustomFormat: value });
                      }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
