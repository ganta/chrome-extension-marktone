import * as React from "react";
import * as marked from "marked";
import * as DOMPurify from "dompurify";
import ReactTextareaAutocomplete, {
  ItemComponentProps
} from "@webscopeio/react-textarea-autocomplete";

import MarktoneRenderer from "../markdown/renderer/marktone-renderer";
import KintoneClient from "../kintone/kintone-client";
import MentionReplacer from "../markdown/replacer/mention-replacer";
import { DirectoryEntityType } from "../kintone/directory-entity";

import "@webscopeio/react-textarea-autocomplete/style.css";

const { useState, useEffect, useRef } = React;

export interface ReplyMention {
  type: DirectoryEntityType;
  code: string;
}

interface MarktoneProps {
  originalFormEl: HTMLFormElement;
  replayMentions: ReplyMention[];
  kintoneClient: KintoneClient;
  mentionReplacer: MentionReplacer;
}

interface MentionCandidateItem {
  type: DirectoryEntityType;
  id: number;
  code: string;
  name: string;
  avatar: string;
}

/**
 * The mention candidate component.
 */
const MentionCandidate = (props: ItemComponentProps<MentionCandidateItem>) => {
  const {
    entity: { code, name, avatar }
  } = props;

  return (
    <span className="mention-candidate">
      <span className="avatar">
        <img className="avatar-image" src={avatar} alt={name} />
      </span>
      <span className="name">
        <span className="code">{code}</span>
        <span className="display-name">{name}</span>
      </span>
    </span>
  );
};

/**
 * Marktone component.
 */
const Marktone = (props: MarktoneProps) => {
  const { originalFormEl, kintoneClient, mentionReplacer } = props;

  // Setup Marked.js
  marked.setOptions({
    gfm: true, // Enable GitHub Flavored Markdown.
    breaks: true, // Add 'br' element on a single line break.
    headerIds: false,
    // @ts-ignore for `listitem()`
    renderer: new MarktoneRenderer(mentionReplacer)
  });

  /**
   * Converts the reply mention objects to the mentions text.
   *
   * @param replyMentions - The reply mention objects
   * @return The string with mentions separated by spaces
   */
  const convertReplyMentionsToText = (
    replyMentions: ReplyMention[]
  ): string => {
    const currentUser = KintoneClient.getLoginUser();
    const normalizedMentions = replyMentions.filter(replyMention => {
      if (replyMention.type !== DirectoryEntityType.USER) return true;
      return replyMention.code !== currentUser.code;
    });
    const mentions = normalizedMentions.map(replyMention =>
      MentionReplacer.createMention(replyMention.type, replyMention.code)
    );
    return mentions.join(" ");
  };

  // The Markdown raw text
  const [rawText, setRawText] = useState("");

  // Inserts the mentions string to the raw text when the reply mentions were set.
  useEffect(() => {
    const replayMentionsText = convertReplyMentionsToText(props.replayMentions);
    setRawText(replayMentionsText === "" ? "" : `${replayMentionsText} `);
  }, [props.replayMentions]);

  // The HTML with Markdown rendered
  const [renderedHTML, setRenderedHTML] = useState("");

  // The original editor field HTML element of kintone
  const originalEditorFieldEl = originalFormEl.querySelector<HTMLElement>(
    'div.ocean-ui-editor-field[role="textbox"]'
  )!;

  // Updates the kintone original editor field with the rendered HTML.
  useEffect(() => {
    originalEditorFieldEl.innerHTML = renderedHTML;
  }, [renderedHTML, originalEditorFieldEl]);

  // Shows the confirm dialog before leave the page.
  useEffect(() => {
    const showConfirmDialog = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", showConfirmDialog);

    return () => {
      window.removeEventListener("beforeunload", showConfirmDialog);
    };
  }, []);

  /**
   * Handles the event when the Markdown textarea is updated.
   */
  const handleChangeMarkdownTextArea = async (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ): Promise<void> => {
    const markdownText = event.target.value;
    setRawText(markdownText);

    await mentionReplacer.fetchDirectoryEntityInText(markdownText);

    const htmlString = marked(markdownText);
    const sanitizedHTML = DOMPurify.sanitize(htmlString);
    setRenderedHTML(sanitizedHTML);
  };

  // The preview area height
  const [previewHeight, setPreviewHeight] = useState(0);

  /**
   * Handles the behavior when the Markdown text area is resized.
   */
  const handleResizeTextArea = (textAreaEl: HTMLTextAreaElement): void => {
    const resizeObserver = new MutationObserver((records, observer) => {
      setPreviewHeight(textAreaEl.offsetHeight);
    });

    resizeObserver.observe(textAreaEl, {
      attributes: true,
      attributeFilter: ["style"]
    });

    setPreviewHeight(textAreaEl.offsetHeight);
  };

  /**
   * Returns the kintone users, organizations and groups that matches the specified token.
   */
  const kintoneDirectoryProvider = async (token: string) => {
    const collection = await kintoneClient.searchDirectory(token);
    return collection.flat();
  };

  // Whether the file is being dragged
  const [isDragging, setDragging] = useState(false);

  /**
   * Handles the event when the dragged file enters the element.
   */
  const handleDragEnter = (): void => {
    setDragging(true);
  };

  /**
   * Handles the event when the dragged file leaves the element.
   */
  const handleDragLeave = (): void => {
    setDragging(false);
  };

  /**
   * Gets the caret position of the Markdown text area.
   */
  const getCaretPosition = (): number => {
    if (reactTextAreaAutocompleteRef.current === null) return 0;
    return reactTextAreaAutocompleteRef.current.getCaretPosition();
  };

  /**
   * Moves the caret position of the Markdown text area.
   */
  const setCaretPosition = (position: number): void => {
    if (reactTextAreaAutocompleteRef.current === null) return;
    reactTextAreaAutocompleteRef.current.setCaretPosition(position);
  };

  /**
   * Returns whether file upload is supported.
   */
  const isSupportedFileUploading = (): boolean => {
    return KintoneClient.isPeoplePage() || KintoneClient.isSpacePage();
  };

  /**
   * Handles the event when the file is dropped to the Markdown text area.
   */
  const handleDropFile = async (
    event: React.DragEvent<HTMLTextAreaElement>
  ): Promise<void> => {
    event.stopPropagation();
    event.preventDefault();

    setDragging(false);

    const files = Array.from<File>(event.dataTransfer.files);

    let caretPosition = getCaretPosition();
    let currentRawText = rawText;

    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;

      const uploadingText = `![](Uploading... ${file.name})`;

      currentRawText = `${currentRawText.slice(
        0,
        caretPosition
      )}${uploadingText}\n${currentRawText.slice(caretPosition)}`;

      caretPosition += uploadingText.length + 1;

      setRawText(currentRawText);
      setCaretPosition(caretPosition);

      const response = await kintoneClient.uploadFile(file);

      const uploadedText = `![${file.name}](tmp:${response.result.fileKey} "=${KintoneClient.defaultThumbnailWidth}")`;

      currentRawText = currentRawText.replace(uploadingText, uploadedText);
      setRawText(currentRawText);

      caretPosition += uploadedText.length - uploadingText.length;
      setCaretPosition(caretPosition);
    }
  };

  // The reference of ReactTextAreaAutocomplete component
  const reactTextAreaAutocompleteRef = useRef<
    ReactTextareaAutocomplete<MentionCandidateItem>
  >(null);

  // The reference of the Markdown text area
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Do nothing.
   */
  const doNothing = () => {};

  return (
    <div className="marktone">
      <div className="editor-area">
        {/*
          // @ts-ignore for some attributes */}
        <ReactTextareaAutocomplete
          value={rawText}
          trigger={{
            "@": {
              dataProvider: kintoneDirectoryProvider,
              component: MentionCandidate,
              output: ({ type, code }) => {
                return MentionReplacer.createMention(type, code);
              }
            }
          }}
          loadingComponent={() => <span>Loading...</span>}
          onChange={handleChangeMarkdownTextArea}
          onDragEnter={isSupportedFileUploading() ? handleDragEnter : doNothing}
          onDragLeave={isSupportedFileUploading() ? handleDragLeave : doNothing}
          onDrop={isSupportedFileUploading() ? handleDropFile : doNothing}
          ref={reactTextAreaAutocompleteRef}
          innerRef={textAreaEl => {
            // @ts-ignore
            textAreaRef.current = textAreaEl;
            if (textAreaEl) {
              textAreaEl.focus();

              handleResizeTextArea(textAreaEl);
            }
          }}
          className={isDragging ? "dragging" : ""}
          containerClassName="autocomplete-container"
          dropdownClassName="autocomplete-dropdown"
          listClassName="autocomplete-list"
          itemClassName="autocomplete-item"
          loaderClassName="autocomplete-loader"
        />
        <div className="preview-wrapper" style={{ height: previewHeight }}>
          {/* Exclude the jsx-a11y/no-static-element-interactions rule because no suitable role exists. */}
          {/* eslint-disable-next-line react/no-danger,jsx-a11y/no-static-element-interactions */}
          <div
            className="preview"
            onClick={event => event.preventDefault()}
            onKeyDown={event => event.preventDefault()}
            onKeyUp={event => event.preventDefault()}
            onKeyPress={event => event.preventDefault()}
            dangerouslySetInnerHTML={{ __html: renderedHTML }}
          />
        </div>
      </div>
    </div>
  );
};

export default Marktone;
