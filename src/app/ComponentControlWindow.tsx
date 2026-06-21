import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  UIButton,
  UISelect,
  UISlider,
  UISwitch,
  UITextField,
  type UISelectOption,
} from "../ui/components";
import {
  COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL,
  emitComponentDynamicIslandSettings,
  openComponentDynamicIslandWindow,
  readComponentDynamicIslandSettings,
  writeComponentDynamicIslandSettings,
  type ComponentDynamicIslandColorMode,
  type ComponentDynamicIslandDefaultContentMode,
  type ComponentDynamicIslandDesign,
  type ComponentDynamicIslandSettings,
} from "./componentDynamicIslandSync";
import {
  COMPONENT_SONG_INFO_CARD_WINDOW_LABEL,
  clearComponentSongInfoCardPosition,
  emitComponentSongInfoCardSettings,
  openComponentSongInfoCardWindow,
  readComponentSongInfoCardSettings,
  writeComponentSongInfoCardSettings,
  type ComponentSongInfoCardBackgroundMode,
  type ComponentSongInfoCardColorMode,
  type ComponentSongInfoCardSettings,
  type ComponentSongInfoCardStyle,
} from "./componentSongInfoCardSync";
import "./styles.css";
import "./component-windows.css";

type ComponentControlPage = "list" | "dynamic-island" | "song-info-card";

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
    "支持 yyyy mm dd hh MM ss，例如：今天是 yyyy 年 mm 月 dd 日",
  songInfoCardTitle: "歌曲信息卡片",
  songInfoCardDescription: "开启一个独立的歌曲信息卡片组件，用于展示当前播放歌曲的关键信息。",
  songInfoCardEnabled: "开启歌曲信息卡片",
  songInfoCardScale: "卡片缩放",
  songInfoCardAlwaysOnTop: "卡片置顶",
  songInfoCardHideOnMouseNearby: "鼠标靠近隐藏",
  songInfoCardHideWhenMainWindowVisible: "主窗口显示时隐藏",
  songInfoCardHideWhenOtherAppsFullscreen: "其他应用全屏时隐藏",
  songInfoCardHideWhenIdle: "无播放时隐藏",
  songInfoCardStyle: "卡片样式",
  songInfoCardColorMode: "卡片配色",
  songInfoCardBackgroundMode: "背景模式",
  songInfoCardResetPosition: "重置卡片位置",
  cards: [
    { id: "dynamic-island", title: "灵动岛" },
    { id: "song-info-card", title: "歌曲信息卡片" },
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
  songInfoCardStyleOptions: [
    { value: "default", label: "默认" },
    { value: "compact", label: "紧凑" },
    { value: "box", label: "方盒" },
    { value: "minimal", label: "简洁" },
  ] satisfies UISelectOption[],
  songInfoCardColorOptions: [
    { value: "follow-app", label: "跟随应用配色" },
    { value: "light", label: "亮色" },
    { value: "dark", label: "暗色" },
    { value: "follow-system", label: "跟随系统" },
  ] satisfies UISelectOption[],
  songInfoCardBackgroundOptions: [
    { value: "solid", label: "单色" },
    { value: "gradient", label: "双色渐变" },
    { value: "cover-blur", label: "封面模糊" },
  ] satisfies UISelectOption[],
} as const;

export function ComponentControlWindow() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [isMaximized, setIsMaximized] = useState(false);
  const [page, setPage] = useState<ComponentControlPage>("list");
  const [dynamicIslandSettings, setDynamicIslandSettings] = useState<ComponentDynamicIslandSettings>(
    () => readComponentDynamicIslandSettings(),
  );
  const [songInfoCardSettings, setSongInfoCardSettings] = useState<ComponentSongInfoCardSettings>(
    () => readComponentSongInfoCardSettings(),
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

  const persistSongInfoCardSettings = async (nextSettings: ComponentSongInfoCardSettings) => {
    setSongInfoCardSettings(nextSettings);
    writeComponentSongInfoCardSettings(nextSettings);
    const cardWindow = await WebviewWindow.getByLabel(COMPONENT_SONG_INFO_CARD_WINDOW_LABEL).catch(
      () => null,
    );

    if (nextSettings.enabled) {
      if (!cardWindow) {
        await openComponentSongInfoCardWindow().catch(() => undefined);
      }
      await emitComponentSongInfoCardSettings(nextSettings).catch(() => undefined);
      return;
    }

    if (cardWindow) {
      await emitComponentSongInfoCardSettings(nextSettings).catch(() => undefined);
      await cardWindow.destroy().catch(() => undefined);
    }
  };

  const updateSongInfoCardSettings = async (patch: Partial<ComponentSongInfoCardSettings>) => {
    const nextSettings = {
      ...songInfoCardSettings,
      ...patch,
    };

    await persistSongInfoCardSettings(nextSettings);
  };

  const handleResetSongInfoCardPosition = async () => {
    clearComponentSongInfoCardPosition();
    const cardWindow = await WebviewWindow.getByLabel(COMPONENT_SONG_INFO_CARD_WINDOW_LABEL).catch(
      () => null,
    );

    if (cardWindow) {
      await cardWindow.destroy().catch(() => undefined);
    }

    if (songInfoCardSettings.enabled) {
      await openComponentSongInfoCardWindow().catch(() => undefined);
      await emitComponentSongInfoCardSettings(songInfoCardSettings).catch(() => undefined);
    }
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
                        } else if (card.id === "song-info-card") {
                          setPage("song-info-card");
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

          {page === "song-info-card" ? (
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
                  <h2>{COMPONENT_HUB_COPY.songInfoCardTitle}</h2>
                  <p>{COMPONENT_HUB_COPY.songInfoCardDescription}</p>
                </div>

                <div className="component-control-window__settings-stack">
                  <UISwitch
                    label={COMPONENT_HUB_COPY.songInfoCardEnabled}
                    checked={songInfoCardSettings.enabled}
                    onChange={(checked) => {
                      void updateSongInfoCardSettings({ enabled: checked });
                    }}
                  />
                  <UISlider
                    label={COMPONENT_HUB_COPY.songInfoCardScale}
                    value={songInfoCardSettings.scale}
                    min={70}
                    max={160}
                    step={1}
                    valueSuffix="%"
                    onChange={(value) => {
                      void updateSongInfoCardSettings({ scale: value });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.songInfoCardAlwaysOnTop}
                    checked={songInfoCardSettings.alwaysOnTop}
                    onChange={(checked) => {
                      void updateSongInfoCardSettings({ alwaysOnTop: checked });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.songInfoCardHideOnMouseNearby}
                    checked={songInfoCardSettings.hideOnMouseNearby}
                    onChange={(checked) => {
                      void updateSongInfoCardSettings({ hideOnMouseNearby: checked });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.songInfoCardHideWhenMainWindowVisible}
                    checked={songInfoCardSettings.hideWhenMainWindowVisible}
                    onChange={(checked) => {
                      void updateSongInfoCardSettings({ hideWhenMainWindowVisible: checked });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.songInfoCardHideWhenOtherAppsFullscreen}
                    checked={songInfoCardSettings.hideWhenOtherAppsFullscreen}
                    onChange={(checked) => {
                      void updateSongInfoCardSettings({ hideWhenOtherAppsFullscreen: checked });
                    }}
                  />
                  <UISwitch
                    label={COMPONENT_HUB_COPY.songInfoCardHideWhenIdle}
                    checked={songInfoCardSettings.hideWhenIdle}
                    onChange={(checked) => {
                      void updateSongInfoCardSettings({ hideWhenIdle: checked });
                    }}
                  />
                  <UISelect
                    label={COMPONENT_HUB_COPY.songInfoCardStyle}
                    options={COMPONENT_HUB_COPY.songInfoCardStyleOptions as UISelectOption[]}
                    value={songInfoCardSettings.style}
                    onChange={(value) => {
                      void updateSongInfoCardSettings({
                        style: value as ComponentSongInfoCardStyle,
                      });
                    }}
                  />
                  <UISelect
                    label={COMPONENT_HUB_COPY.songInfoCardColorMode}
                    options={COMPONENT_HUB_COPY.songInfoCardColorOptions as UISelectOption[]}
                    value={songInfoCardSettings.colorMode}
                    onChange={(value) => {
                      void updateSongInfoCardSettings({
                        colorMode: value as ComponentSongInfoCardColorMode,
                      });
                    }}
                  />
                  <UISelect
                    label={COMPONENT_HUB_COPY.songInfoCardBackgroundMode}
                    options={COMPONENT_HUB_COPY.songInfoCardBackgroundOptions as UISelectOption[]}
                    value={songInfoCardSettings.backgroundMode}
                    onChange={(value) => {
                      void updateSongInfoCardSettings({
                        backgroundMode: value as ComponentSongInfoCardBackgroundMode,
                      });
                    }}
                  />
                  <UIButton
                    variant="secondary"
                    onClick={() => {
                      void handleResetSongInfoCardPosition();
                    }}
                  >
                    {COMPONENT_HUB_COPY.songInfoCardResetPosition}
                  </UIButton>
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
