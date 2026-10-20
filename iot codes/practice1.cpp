#include<iostream>
#include<cstdio>
using namespace std;

void solve(){
  char ch[6] = "abcde";
  int ans = 0;
  for (int i = 0; i<5; i++){
    ans += (ch[i] - 'a');
  }

  printf("%d", ans);
}

int main(){
  solve();
  return 0;
}