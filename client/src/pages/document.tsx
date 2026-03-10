import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Download, FileText, Check, X, MessageSquareQuote, RefreshCw, Lightbulb, Pen } from "lucide-react";

interface EvidenceCard {
  id: number;
  documentId: number;
  tag: string;
  cite: string;
  body: string;
  cardIndex: number;
  isAnalytic: boolean;
  customTag: string | null;
  customCite: string | null;
  sectionHeading: string | null;
}

interface DocumentCardsResponse {
  document: {
    id: number;
    originalFilename: string;
    tags: string[];
  };
  cards: EvidenceCard[];
}

export default function DocumentPage() {
  const { toast } = useToast();
  const [, params] = useRoute("/documents/:id");
  const docId = params?.id ? parseInt(params.id) : 0;
  const [recutCardId, setRecutCardId] = useState<number | null>(null);
  const [recutName, setRecutName] = useState("");

  const { data, isLoading, error } = useQuery<DocumentCardsResponse>({
    queryKey: ["/api/documents", docId, "cards"],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${docId}/cards`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: docId > 0,
  });

  const reparseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/documents/${docId}/reparse-cards`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", docId, "cards"] });
      toast({ title: `Re-parsed: ${data.cardCount} cards found` });
    },
    onError: () => {
      toast({ title: "Re-parse failed", variant: "destructive" });
    },
  });

  const signatureMutation = useMutation({
    mutationFn: async ({ cardId, customCite }: { cardId: number; customCite: string | null }) => {
      const res = await apiRequest("PATCH", `/api/cards/${cardId}/signature`, { customCite });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", docId, "cards"] });
      setRecutCardId(null);
      setRecutName("");
      toast({ title: "Recut signature added" });
    },
    onError: () => {
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  const startRecut = (card: EvidenceCard) => {
    setRecutCardId(card.id);
    const existingRecut = (card.customCite || card.cite).match(/recut\s+(.+)$/i);
    setRecutName(existingRecut ? existingRecut[1] : "");
  };

  const saveRecut = (card: EvidenceCard) => {
    const name = recutName.trim();
    if (!name) {
      setRecutCardId(null);
      return;
    }
    const baseCite = (card.customCite || card.cite).replace(/\s*recut\s+.+$/i, "").trim();
    const newCite = baseCite ? `${baseCite} recut ${name}` : `recut ${name}`;
    signatureMutation.mutate({ cardId: card.id, customCite: newCite });
  };

  const removeRecut = (card: EvidenceCard) => {
    const baseCite = (card.customCite || card.cite).replace(/\s*recut\s+.+$/i, "").trim();
    signatureMutation.mutate({ cardId: card.id, customCite: baseCite || null });
  };

  const handleDownload = () => {
    if (!data) return;
    const link = document.createElement("a");
    link.href = `/api/documents/${docId}/download`;
    link.download = data.document.originalFilename;
    link.click();
  };

  if (!docId) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-muted-foreground">Invalid document ID</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/library">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold tracking-tight truncate" data-testid="text-page-title">
            {data?.document.originalFilename || "Loading..."}
          </h2>
          <p className="text-muted-foreground text-sm">
            {data ? `${data.cards.length} evidence card${data.cards.length !== 1 ? "s" : ""} detected` : "Loading cards..."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reparseMutation.mutate()}
            disabled={reparseMutation.isPending}
            data-testid="button-reparse"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${reparseMutation.isPending ? "animate-spin" : ""}`} />
            Re-parse
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload} data-testid="button-download-doc">
            <Download className="w-4 h-4 mr-1" />
            Download
          </Button>
        </div>
      </div>

      {data?.document.tags && data.document.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {data.document.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-5 w-2/3" /></CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">Failed to load document cards.</p>
          </CardContent>
        </Card>
      )}

      {data && data.cards.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground/20 mb-4" />
            <p className="font-medium text-muted-foreground">No evidence cards detected</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try re-parsing the document or the file may not contain standard debate card formatting.
            </p>
          </CardContent>
        </Card>
      )}

      {data && data.cards.length > 0 && (
        <div className="space-y-3">
          {data.cards.map((card, index) => {
            const isRecut = recutCardId === card.id;
            const displayCite = card.customCite || card.cite;
            const hasRecut = /recut\s+/i.test(displayCite);
            const prevCard = index > 0 ? data.cards[index - 1] : null;
            const showSectionHeader = card.sectionHeading && card.sectionHeading !== prevCard?.sectionHeading;

            return (
              <div key={card.id}>
              {showSectionHeader && (
                <div className="flex items-center gap-3 pt-4 pb-1" data-testid={`section-header-${index}`}>
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide">{card.sectionHeading}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <Card data-testid={`card-evidence-${card.id}`} className={card.isAnalytic ? "border-dashed" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono shrink-0">#{index + 1}</Badge>
                        {card.isAnalytic && (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Lightbulb className="w-3 h-3" />
                            Analytic
                          </Badge>
                        )}
                        {hasRecut && (
                          <Badge variant="secondary" className="text-xs gap-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                            <Pen className="w-2.5 h-2.5" />
                            Recut
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-sm leading-snug" data-testid={`text-card-tag-${card.id}`}>
                        <MessageSquareQuote className="w-4 h-4 inline mr-1.5 text-primary" />
                        {card.tag}
                      </CardTitle>
                    </div>
                    {!card.isAnalytic && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-xs"
                        onClick={() => startRecut(card)}
                        data-testid={`button-recut-${card.id}`}
                      >
                        <Pen className="w-3 h-3 mr-1" />
                        {hasRecut ? "Edit Sig" : "Recut"}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {displayCite && (
                    <p className="text-xs text-muted-foreground italic" data-testid={`text-card-cite-${card.id}`}>
                      {displayCite}
                    </p>
                  )}

                  {isRecut && (
                    <div className="flex items-center gap-2">
                      <Input
                        value={recutName}
                        onChange={(e) => setRecutName(e.target.value)}
                        placeholder="Your name/initials"
                        className="text-xs h-8 max-w-[200px]"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveRecut(card);
                          }
                        }}
                        autoFocus
                        data-testid={`input-recut-name-${card.id}`}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8 text-xs"
                        onClick={() => saveRecut(card)}
                        disabled={!recutName.trim() || signatureMutation.isPending}
                        data-testid={`button-save-recut-${card.id}`}
                      >
                        <Check className="w-3 h-3 mr-1" />
                        Save
                      </Button>
                      {hasRecut && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-destructive hover:text-destructive"
                          onClick={() => { removeRecut(card); }}
                          disabled={signatureMutation.isPending}
                          data-testid={`button-remove-recut-${card.id}`}
                        >
                          Remove
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => { setRecutCardId(null); setRecutName(""); }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  )}

                  {card.body && !card.isAnalytic && (
                    <div className="bg-muted/30 rounded-md p-3">
                      <p className="text-xs leading-relaxed whitespace-pre-line" data-testid={`text-card-body-${card.id}`}>
                        {card.body.length > 600 ? card.body.slice(0, 600) + "..." : card.body}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
