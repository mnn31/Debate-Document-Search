import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Download, FileText, Sparkles, AlertCircle } from "lucide-react";

interface SearchResult {
  document: {
    id: number;
    filename: string;
    originalFilename: string;
    tags: string[];
    uploadedAt: string;
  };
  matchingSections: Array<{
    id: number;
    heading: string;
    content: string;
    sectionIndex: number;
  }>;
  aiSummary: string;
  sectionHint: string;
}

interface SearchResponse {
  results: SearchResult[];
  aiEnhanced: boolean;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");

  const searchMutation = useMutation({
    mutationFn: async (searchQuery: string) => {
      const res = await apiRequest("POST", "/api/search", { query: searchQuery });
      return (await res.json()) as SearchResponse;
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      searchMutation.mutate(query.trim());
    }
  };

  const handleDownload = (id: number, filename: string) => {
    const link = document.createElement("a");
    link.href = `/api/documents/${id}/download`;
    link.download = filename;
    link.click();
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Search Evidence</h2>
        <p className="text-muted-foreground">
          Search your evidence library using concepts, not just keywords. Try "dedev", "econ decline good", or "spark".
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2" data-testid="form-search">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search arguments, concepts, or impact chains..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Button type="submit" disabled={searchMutation.isPending || !query.trim()} data-testid="button-search">
          {searchMutation.isPending ? "Searching..." : "Search"}
        </Button>
      </form>

      {searchMutation.isPending && (
        <div className="space-y-4" data-testid="search-loading">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {searchMutation.isError && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <p className="text-sm text-destructive">Search failed. Please try again.</p>
          </CardContent>
        </Card>
      )}

      {searchMutation.isSuccess && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground" data-testid="text-result-count">
              {searchMutation.data.results.length} result{searchMutation.data.results.length !== 1 ? "s" : ""} found
            </p>
            {searchMutation.data.aiEnhanced && (
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="w-3 h-3" />
                AI-Enhanced
              </Badge>
            )}
          </div>

          {searchMutation.data.results.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
                <p className="font-medium text-muted-foreground">No matching evidence found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Try different keywords or upload more evidence files
                </p>
              </CardContent>
            </Card>
          )}

          {searchMutation.data.results.map((result) => (
            <Card key={result.document.id} className="hover-elevate" data-testid={`card-result-${result.document.id}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <CardTitle className="text-base truncate" data-testid={`text-filename-${result.document.id}`}>
                    <FileText className="w-4 h-4 inline mr-2 text-primary" />
                    {result.document.originalFilename}
                  </CardTitle>
                  <div className="flex items-center gap-1 flex-wrap">
                    {result.document.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleDownload(result.document.id, result.document.originalFilename)}
                  data-testid={`button-download-${result.document.id}`}
                >
                  <Download className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="bg-primary/5 rounded-md p-3 border border-primary/10">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-sm" data-testid={`text-summary-${result.document.id}`}>
                      {result.aiSummary}
                    </p>
                  </div>
                </div>

                {result.sectionHint && (
                  <p className="text-xs text-muted-foreground">
                    Look in section: <span className="font-medium text-foreground">{result.sectionHint}</span>
                  </p>
                )}

                {result.matchingSections.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Matching Sections</p>
                    {result.matchingSections.slice(0, 3).map((section) => (
                      <div
                        key={section.id}
                        className="text-sm rounded-md bg-muted/50 p-3 space-y-1"
                        data-testid={`section-${section.id}`}
                      >
                        {section.heading && (
                          <p className="font-medium text-xs text-primary">{section.heading}</p>
                        )}
                        <p className="text-muted-foreground line-clamp-3">
                          {section.content.slice(0, 300)}
                          {section.content.length > 300 ? "..." : ""}
                        </p>
                      </div>
                    ))}
                    {result.matchingSections.length > 3 && (
                      <p className="text-xs text-muted-foreground">
                        +{result.matchingSections.length - 3} more sections
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!searchMutation.isSuccess && !searchMutation.isPending && !searchMutation.isError && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-primary/50" />
          </div>
          <h3 className="font-medium text-lg mb-1">Ready to search</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Type an argument, concept, or impact chain to find relevant evidence across your entire library.
            AI will match semantically even if exact words differ.
          </p>
        </div>
      )}
    </div>
  );
}
