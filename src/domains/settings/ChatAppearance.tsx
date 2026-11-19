import { FontField } from "@/components/FontField";
import { Segmented } from "@/components/Segmented";
import { CodeThemePicker } from "@/domains/appearance/CodeThemePicker";
import {
  CODE_SIZE,
  type HeadingScale,
  LINE_HEIGHTS,
  type ProseSpacing,
  type ProseWidth,
  TEXT_SIZE,
  type ToolActivity,
} from "@/domains/appearance/chatStyle";
import { ChatPreview } from "@/domains/appearance/previews/ChatPreview";
import { SizeField } from "@/domains/appearance/SizeField";
import { useAppearance } from "@/domains/appearance/store";
import { useFontChoices } from "@/domains/appearance/useFontChoices";
import { AppearanceGroup } from "./AppearanceGroup";
import { SettingRow } from "./SettingRow";

const WIDTHS: { value: ProseWidth; label: string }[] = [
  { value: "readable", label: "Readable" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];
const SPACINGS: { value: ProseSpacing; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "relaxed", label: "Relaxed" },
];
const HEADINGS: { value: HeadingScale; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "standard", label: "Standard" },
  { value: "large", label: "Large" },
];
const TOOLS: { value: ToolActivity; label: string }[] = [
  { value: "folded", label: "Folded" },
  { value: "lines", label: "One line each" },
  { value: "expanded", label: "Expanded" },
];
const LINE_OPTIONS = LINE_HEIGHTS.map((h) => ({ value: h, label: String(h) }));

// Appearance → Chat & transcript: how an agent's Markdown reads in the chat
// view, the terminal's transcript view and their cards. Every value is a
// custom property the shared `.md.prose` class reads (styles/markdown.css), so
// all of them change together.
export function ChatAppearance() {
  const chat = useAppearance((s) => s.prefs.chat);
  const updateChat = useAppearance((s) => s.updateChat);
  const reset = useAppearance((s) => s.reset);
  const fonts = useFontChoices();
  return (
    <AppearanceGroup
      title="Chat & transcript"
      desc="How agent replies, thinking, plans and questions read, in the chat and the transcript."
      preview={<ChatPreview />}
      onReset={() => reset(["chat"])}
    >
      <SettingRow label="Text font" hint="Any installed font. Blank uses the interface font.">
        <FontField
          label="Chat text font"
          value={chat.textFont}
          onChange={(textFont) => updateChat({ textFont })}
          suggestions={fonts.ui.suggested}
          installed={fonts.ui.installed}
          defaultFamily="Interface font"
        />
      </SettingRow>
      <SettingRow
        label="Text size"
        hint={`Pixels, ${TEXT_SIZE.min}–${TEXT_SIZE.max}. Blank follows the interface (density).`}
      >
        <SizeField
          label="Chat text size"
          value={chat.textSize}
          range={TEXT_SIZE}
          onChange={(textSize) => updateChat({ textSize })}
        />
      </SettingRow>
      <SettingRow label="Line height" hint="Space between the lines of a paragraph.">
        <Segmented
          label="Line height"
          value={chat.lineHeight}
          options={LINE_OPTIONS}
          onChange={(lineHeight) => updateChat({ lineHeight })}
        />
      </SettingRow>
      <SettingRow label="Paragraph spacing" hint="Space between paragraphs, lists and blocks.">
        <Segmented
          label="Paragraph spacing"
          value={chat.spacing}
          options={SPACINGS}
          onChange={(spacing) => updateChat({ spacing })}
        />
      </SettingRow>
      <SettingRow label="Headings" hint="How much larger headings are than the text.">
        <Segmented
          label="Heading scale"
          value={chat.headings}
          options={HEADINGS}
          onChange={(headings) => updateChat({ headings })}
        />
      </SettingRow>
      <SettingRow
        label="Reading width"
        hint="How wide the chat, the transcript, the composer, the Plan tab, the Pull request tab and the Files tab's Markdown preview read. Readable keeps lines short enough to scan; Full uses the whole pane."
      >
        <Segmented
          label="Reading width"
          value={chat.width}
          options={WIDTHS}
          onChange={(width) => updateChat({ width })}
        />
      </SettingRow>
      <SettingRow
        label="Tool activity"
        hint="How tool calls first show: folded into one line per turn, a line per call, or open."
      >
        <Segmented
          label="Tool activity"
          value={chat.tools}
          options={TOOLS}
          onChange={(tools) => updateChat({ tools })}
        />
      </SettingRow>

      <div className="ap-sub">
        <div className="label">Code</div>
        <div className="hint">Inline code and code blocks.</div>
      </div>
      <SettingRow label="Code font" hint="Blank uses the interface's code font.">
        <FontField
          label="Chat code font"
          value={chat.codeFont}
          onChange={(codeFont) => updateChat({ codeFont })}
          suggestions={fonts.mono.suggested}
          installed={fonts.mono.installed}
          defaultFamily="Same as code font"
        />
      </SettingRow>
      <SettingRow
        label="Code size"
        hint={`Pixels, ${CODE_SIZE.min}–${CODE_SIZE.max}. Blank keeps it in proportion to the text.`}
      >
        <SizeField
          label="Chat code size"
          value={chat.codeSize}
          range={CODE_SIZE}
          onChange={(codeSize) => updateChat({ codeSize })}
        />
      </SettingRow>
      <div className="ap-sub">
        <div className="label">Code theme</div>
        <div className="hint">
          Colours every code block in the app. Match theme follows the app theme.
        </div>
      </div>
      <CodeThemePicker />
    </AppearanceGroup>
  );
}
