#include<iostream>
#include<vector>
using namespace std;
int main(){
  vector<int> number = {1, 2, 3, 2, 3};
  int x = 0;
  for (int i : number){
    x ^= i;
  }
  cout<<x<<endl;
  return 0;
}
